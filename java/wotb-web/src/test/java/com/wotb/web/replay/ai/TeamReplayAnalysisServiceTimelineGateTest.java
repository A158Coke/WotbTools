package com.wotb.web.replay.ai;

import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ReplayStreamHeader;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.processing.BatchAnalyzer;
import com.wotb.core.replay.processing.ReplayIdentity;
import com.wotb.core.replay.processing.ReplayPerspectiveGroup;
import com.wotb.core.replay.processing.ReplayProcessingCapabilities;
import com.wotb.core.replay.processing.ReplayProcessingResult;
import com.wotb.core.replay.processing.ReplayProcessingStatus;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayMetadata;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;
import com.wotb.web.replay.ai.gateway.AiChatGateway;
import com.wotb.web.replay.ai.gateway.AiChatRequest;
import com.wotb.web.replay.ai.gateway.AiChatResponse;
import com.wotb.web.replay.ai.gateway.AiReplayAnalysisConfig;
import com.wotb.web.replay.exception.AiTimelineUnusableException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * PR #102 ：Team AI Canonical Timeline hard gate（真实 Team production
 * orchestration path，非 Mockito）。
 * <p>通过 {@link TeamReplayAnalysisService#analyzeTeamGroups}（Team AI 唯一 production 编排
 * 入口）验证：timeline invalid / reconstruction 缺失 → {@link AiTimelineUnusableException}
 * 且 AI Gateway requests = 0（Call #1 / Call #2 / Team Autopsy 均不执行）；valid timeline →
 * Call #2 prompt 必含 TACTICAL TIMELINE 与确定性 battle-relative 事实；
 * {@link TeamAiPromptBuilder} 不引用 {@code BattleTimelineBuilder}（build 唯一入口在 orchestration）。</p>
 */
class TeamReplayAnalysisServiceTimelineGateTest {

    private static final float START_RAW = 1000f;

    private FakeAiChatGateway gateway;
    private TeamReplayAnalysisService service;

    @BeforeEach
    void setUp() {
        gateway = new FakeAiChatGateway();
        final AiReplayAnalysisConfig config = new AiReplayAnalysisConfig(
                new ConservativeDeepSeekTokenEstimator(), "test-model",
                200_000, 131_072, 8192, 1000, true, "high", 315, 4096);
        service = new TeamReplayAnalysisService(
                gateway, config,
                new PreBattleStrategicService(gateway, config, null),
                new TeamAutopsyService(gateway, config, null),
                System::nanoTime, null);
    }

    @Test
    void timelineInvalidClockUnresolvedRejectsBeforeAnyLlmCall() {
        // Team features 可形成（battle roster + perspective 解析成功），但 canonical timeline
        // 时钟不可解析（无 battle start、无 BattleEndedEvent）→ TIMELINE_CLOCK_UNRESOLVED。
        final List<ReplayPerspectiveGroup> groups = groupsOf(teamResult(
                "clock.wotbreplay", "arena-clock", "Ally", 1001L, 1, clockUnresolvedRecon()));

        final AiTimelineUnusableException e = assertThrows(AiTimelineUnusableException.class,
                () -> service.analyzeTeamGroups(groups, AllowedLanguage.ZH));

        assertTrue(e.getMessage().contains("AI_TIMELINE_UNUSABLE"), e.getMessage());
        assertTrue(e.getMessage().contains("TIMELINE_CLOCK_UNRESOLVED"), e.getMessage());
        assertTrue(gateway.requests.isEmpty(),
                "timeline invalid must reject before any LLM call (Call #1/Call #2/Autopsy = 0): "
                        + gateway.requests);
    }

    @Test
    void noReconstructionRejectsBeforeAnyLlmCall() {
        final List<ReplayPerspectiveGroup> groups = groupsOf(teamResult(
                "norecon.wotbreplay", "arena-norecon", "Ally", 1001L, 1, null));

        final AiTimelineUnusableException e = assertThrows(AiTimelineUnusableException.class,
                () -> service.analyzeTeamGroups(groups, AllowedLanguage.ZH));

        assertTrue(e.getMessage().contains("AI_TIMELINE_UNUSABLE"), e.getMessage());
        assertTrue(e.getMessage().contains("NO_RECONSTRUCTION"), e.getMessage());
        assertTrue(gateway.requests.isEmpty(),
                "missing reconstruction must reject before any LLM call: " + gateway.requests);
    }

    @Test
    void validTimelineInjectedIntoTeamCall2Prompt() {
        final List<ReplayPerspectiveGroup> groups = groupsOf(teamResult(
                "valid.wotbreplay", "arena-valid", "Ally", 1001L, 1, validRecon()));

        final TeamAnalyzeResult result = service.analyzeTeamGroups(groups, AllowedLanguage.ZH);

        assertNotNull(result.analysis());
        // Call #2（SINGLE_TEAM_BATTLE）prompt 必须包含 TACTICAL TIMELINE 与确定性事实
        final AiChatRequest call2 = gateway.requests.stream()
                .filter(r -> "SINGLE_TEAM_BATTLE".equals(r.analysisMode()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no Call #2 request: " + gateway.requests));
        final String body = call2.userPrompt();
        assertTrue(body.contains("TACTICAL TIMELINE"), body);
        assertTrue(body.contains("EPISODE 1"), body);
        assertTrue(body.contains("战斗总时长: "), body);
        // Natural Coach 轮：Call #2 输入必须携带确定性 GROUNDING FACTS（供 structured claims 引用）
        assertTrue(body.contains("=== GROUNDING FACTS"), "Call #2 输入必须注入 GROUNDING FACTS: " + body);
        // valid path 不 gate 拒绝：Call #1 与 Call #2 都真实发生
        assertTrue(gateway.requests.stream()
                .anyMatch(r -> "PRE_BATTLE_STRATEGIC_PRIOR".equals(r.analysisMode())),
                "Call #1 must run when timeline is valid: " + gateway.requests);
    }

    @Test
    void teamPromptBuilderDoesNotBuildTimelineItself() throws Exception {
        // 结构契约（PR #102 ）：build+validation 唯一入口在 orchestration 层；
        // TeamAiPromptBuilder 不得再引用 BattleTimelineBuilder（避免二次 build / 静默降级）。
        final Path classFile = Path.of(TeamAiPromptBuilder.class.getResource(
                "TeamAiPromptBuilder.class").toURI());
        final String classText = new String(Files.readAllBytes(classFile), StandardCharsets.ISO_8859_1);
        assertFalse(classText.contains("BattleTimelineBuilder"),
                "TeamAiPromptBuilder must not reference BattleTimelineBuilder (build happens once in orchestration)");
    }

    // ---- helpers ----

    private static List<ReplayPerspectiveGroup> groupsOf(final ReplayProcessingResult result) {
        return new BatchAnalyzer().analyze(List.of(result)).groups();
    }

    private static ReplayProcessingResult teamResult(final String fileName,
                                                     final String arenaId,
                                                     final String recorderNickname,
                                                     final long recorderAccountId,
                                                     final int recorderTeam,
                                                     final ReplayReconstruction recon) {
        final Battle battle = new Battle();
        battle.arenaId = arenaId;
        battle.mapName = "team_map";
        battle.arenaBonusType = 2;
        battle.durationS = 120.0;
        battle.winnerTeam = 1;
        battle.recorder = recorderNickname;
        final List<PlayerResult> players = new ArrayList<>();
        for (int i = 0; i < 2; i++) {
            final PlayerResult ally = new PlayerResult();
            ally.accountId = recorderTeam == 1 && i == 0 ? recorderAccountId : 1001L + i;
            ally.nickname = recorderTeam == 1 && i == 0 ? recorderNickname : "Ally" + i;
            ally.team = 1;
            ally.tankId = 4481L;
            ally.tankName = "Kranvagn";
            ally.damageDealt = 1000;
            ally.survived = true;
            players.add(ally);
        }
        for (int i = 0; i < 2; i++) {
            final PlayerResult enemy = new PlayerResult();
            enemy.accountId = 2001L + i;
            enemy.nickname = "Enemy" + i;
            enemy.team = 2;
            enemy.tankId = 29985L;
            enemy.tankName = "SPHT";
            enemy.damageDealt = 800;
            enemy.survived = true;
            players.add(enemy);
        }
        battle.players = players;
        final var capabilities = new ReplayProcessingCapabilities(
                true, true, false, false, false, true, false, false);
        return new ReplayProcessingResult(
                fileName, ReplayProcessingStatus.PARTIAL_SUCCESS,
                new ReplayIdentity("hash-" + fileName, arenaId, "11.0", "team_map",
                        recorderAccountId, null),
                battle, recon, null, capabilities, null, null);
    }

    /** 有效团队 fixture：battle-relative 时钟 IDENTIFIED + 双方实体位置/血量 + 首次接敌。 */
    private static ReplayReconstruction validRecon() {
        final ReplayMetadata meta = new ReplayMetadata(
                "arena", "team_map", "1", "1", 2, "rec1", "", 120.0, 0L);
        final ReplayStreamHeader header = new ReplayStreamHeader(0x12345678L, new byte[8], "h", "v", 15);
        final ReplayCoverage coverage = new ReplayCoverage(10, 10, 0, 0, 0, 1.0, Map.of());
        final ReplayStreamDiagnostics diag = new ReplayStreamDiagnostics(0, 0, 0f, 0f, 0, Map.of());
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(mapping(0, 1, 1001L));
        events.add(mapping(1, 2, 1002L));
        events.add(mapping(2, 3, 2001L));
        events.add(mapping(3, 4, 2002L));
        events.add(position(4, 1, 0, 10f, 10f));
        events.add(position(5, 2, 0, 20f, 20f));
        events.add(position(6, 3, 0, -10f, -10f));
        events.add(position(7, 4, 0, -20f, -20f));
        events.add(health(8, 1, 0, 2000, true));
        events.add(health(9, 2, 0, 1800, true));
        events.add(health(10, 3, 0, 1500, true));
        events.add(health(11, 4, 0, 1500, true));
        // 首次接敌（battle-relative 5s）
        events.add(new DamageEvent(12, new ReplayTimestamp(START_RAW + 5f, null), 8,
                DecodeConfidence.EXACT, 1, 3, null, null, 420, false));
        return new ReplayReconstruction(meta, header, 120f, START_RAW, List.of(),
                events, List.of(), BattleStateSnapshot.empty(), coverage, diag);
    }

    /** 时钟不可解析 fixture：无 battle start、无 BattleEndedEvent → TIMELINE_CLOCK_UNRESOLVED。 */
    private static ReplayReconstruction clockUnresolvedRecon() {
        final ReplayMetadata meta = new ReplayMetadata(
                "arena", "team_map", "1", "1", 2, "rec1", "", 120.0, 0L);
        final ReplayStreamHeader header = new ReplayStreamHeader(0x12345678L, new byte[8], "h", "v", 15);
        final ReplayCoverage coverage = new ReplayCoverage(1, 1, 0, 0, 0, 1.0, Map.of());
        final ReplayStreamDiagnostics diag = new ReplayStreamDiagnostics(0, 0, 0f, 0f, 0, Map.of());
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(mapping(0, 1, 1001L));
        return new ReplayReconstruction(meta, header, 120f, null, List.of(),
                events, List.of(), BattleStateSnapshot.empty(), coverage, diag);
    }

    private static ParticipantMappingEvent mapping(final int seq, final int eid, final long accountId) {
        return new ParticipantMappingEvent(seq, new ReplayTimestamp(START_RAW, null), 8,
                DecodeConfidence.EXACT, eid, accountId);
    }

    private static PositionChangedEvent position(final int seq, final int eid, final float battleSec,
                                                 final float x, final float z) {
        return new PositionChangedEvent(seq, new ReplayTimestamp(START_RAW + battleSec, null), 10,
                DecodeConfidence.EXACT, eid, 0, 0, x, 0f, z, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0);
    }

    private static HealthChangedEvent health(final int seq, final int eid, final float battleSec,
                                             final int hp, final boolean alive) {
        return new HealthChangedEvent(seq, new ReplayTimestamp(START_RAW + battleSec, null), 7,
                DecodeConfidence.EXACT, eid, hp, null, alive);
    }

    /** 记录全部 gateway 请求的替身（从不发起真实 HTTP）。 */
    private static final class FakeAiChatGateway implements AiChatGateway {
        final List<AiChatRequest> requests = new CopyOnWriteArrayList<>();
        volatile boolean configured = true;

        @Override
        public boolean isConfigured() {
            return configured;
        }

        @Override
        public AiChatResponse chat(final AiChatRequest request) {
            requests.add(request);
            return new AiChatResponse(
                    "{\"primaryDiagnosis\":{\"title\":\"主判断\",\"reasoning\":\"理由\"},"
                            + "\"reviewMarkdown\":\"## 团队复盘\\n\\n这是一段复盘。\",\"claims\":[]}",
                    "DeepSeek", "test-model",
                    0, 0, 0, 0, 0, 0, "stop");
        }
    }
}
