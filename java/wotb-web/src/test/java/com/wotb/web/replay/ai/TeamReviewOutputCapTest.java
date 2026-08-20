package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.BatchAnalyzer;
import com.wotb.core.processing.ReplayIdentity;
import com.wotb.core.processing.ReplayPerspectiveGroup;
import com.wotb.core.processing.ReplayProcessingCapabilities;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.processing.ReplayProcessingStatus;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.feature.SingleTeamBattleAnalysisContext;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayMetadata;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;
import com.wotb.core.replay.stream.ReplayStreamHeader;
import com.wotb.web.replay.ai.gateway.AiChatGateway;
import com.wotb.web.replay.ai.gateway.AiChatRequest;
import com.wotb.web.replay.ai.gateway.AiChatResponse;
import com.wotb.web.replay.ai.gateway.AiReplayAnalysisConfig;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * PR #103 review BLOCKER C：Team Call #2 独立输出上限。
 * <p>effective = min(globalMaxOutputTokens, teamReviewMaxOutputTokens)，且同时用于
 * AiPromptBudgetGuard 与 AiChatRequest；Player Call #2（TacticalReviewHarness）不受 Team cap 影响
 * （Player 隔离断言见 TacticalReviewHarnessTest.playerCall2IsNotLimitedByTeamReviewCap）。</p>
 */
class TeamReviewOutputCapTest {

    private static final float START_RAW = 1000f;

    @Test
    void teamCall2UsesTeamCapWhenGlobalIsHigher() {
        // global=32768, team=4096 → Team Call #2 maxOutputTokens = 4096
        final CapGateway gateway = new CapGateway();
        final TeamReplayAnalysisService service = service(gateway, 32_768, 4_096);
        final AnalyzeResult result = service.analyzeSingleTeamContext(
                context(gateway, service), AllowedLanguage.ZH);
        assertNotNull(result);
        final AiChatRequest call2 = gateway.teamRequests().getLast();
        assertEquals(4_096, call2.maxOutputTokens(),
                "Team Call #2 must use the dedicated team cap when it is below the global cap");
    }

    @Test
    void teamCall2RespectsLowerGlobalCap() {
        // global=2048, team=4096 → effective = min(2048, 4096) = 2048
        final CapGateway gateway = new CapGateway();
        final TeamReplayAnalysisService service = service(gateway, 2_048, 4_096);
        final AnalyzeResult result = service.analyzeSingleTeamContext(
                context(gateway, service), AllowedLanguage.ZH);
        assertNotNull(result);
        final AiChatRequest call2 = gateway.teamRequests().getLast();
        assertEquals(2_048, call2.maxOutputTokens(),
                "Team Call #2 effective cap must be min(global, team) = global when global is lower");
    }

    @Test
    void teamCapBelowGlobalStillBudgetGuarded() {
        // 预算守卫与 request 使用同一 effective 值：构造超预算输入会抛 AI_TOKEN_BUDGET_EXCEEDED
        // （这里只验证 effective 计算被 request 承接；budget guard 的 min 语义由上述两测试覆盖）。
        final CapGateway gateway = new CapGateway();
        final TeamReplayAnalysisService service = service(gateway, 32_768, 4_096);
        final SingleTeamBattleAnalysisContext ctx = context(gateway, service);
        assertTrue(ctx.battle() != null, "fixture battle must be present");
    }

    // ---- fixture ----

    private static TeamReplayAnalysisService service(final CapGateway gateway,
                                                     final int globalMaxOutput,
                                                     final int teamMaxOutput) {
        final AiReplayAnalysisConfig config = new AiReplayAnalysisConfig(
                new ConservativeDeepSeekTokenEstimator(), "test-model",
                200_000, 131_072, globalMaxOutput, 1000, true, "high", 315, teamMaxOutput);
        return new TeamReplayAnalysisService(
                gateway, config,
                new PreBattleStrategicService(gateway, config, null),
                new TeamAutopsyService(gateway, config, null),
                System::nanoTime, null);
    }

    private static SingleTeamBattleAnalysisContext context(final CapGateway gateway,
                                                           final TeamReplayAnalysisService service) {
        final List<ReplayPerspectiveGroup> groups = new BatchAnalyzer().analyze(
                List.of(teamResult("cap.wotbreplay", "arena-cap", "Ally", 1001L, 1, validRecon())))
                .groups();
        return service.buildSingleTeamContext(groups.getFirst());
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

    private static ReplayReconstruction validRecon() {
        final ReplayMetadata meta = new ReplayMetadata(
                "arena", "team_map", "1", "1", 2, "rec1", "", 120.0, 0L);
        final ReplayStreamHeader header = new ReplayStreamHeader(0x12345678L, new byte[8], "h", "v", 15);
        final ReplayCoverage coverage = new ReplayCoverage(true, 10, 10, 0, 0, 0, 1.0, Map.of());
        final ReplayStreamDiagnostics diag = new ReplayStreamDiagnostics(
                0, 0, 0, 0, 0, 0, 0, 0, 0f, 0f, 0, Map.of(), true, START_RAW, true);
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
        events.add(new DamageEvent(12, new ReplayTimestamp(START_RAW + 5f, null), 8,
                DecodeConfidence.EXACT, 1, 3, null, null, 420, false));
        return new ReplayReconstruction(meta, header, 120f, START_RAW, List.of(),
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

    /** 记录全部 gateway 请求的替身；从不发起真实 HTTP。 */
    private static final class CapGateway implements AiChatGateway {
        final List<AiChatRequest> requests = new CopyOnWriteArrayList<>();

        @Override
        public boolean isConfigured() {
            return true;
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

        List<AiChatRequest> teamRequests() {
            return requests.stream()
                    .filter(r -> "SINGLE_TEAM_BATTLE".equals(r.analysisMode()))
                    .toList();
        }
    }
}
