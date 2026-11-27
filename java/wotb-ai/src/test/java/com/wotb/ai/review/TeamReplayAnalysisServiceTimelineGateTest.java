package com.wotb.ai.review;

import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.reconstruction.ReplayStreamHeader;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayMetadata;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayStreamDiagnostics;
import com.wotb.ai.gateway.AiChatGateway;
import com.wotb.ai.gateway.AiChatRequest;
import com.wotb.ai.gateway.AiChatResponse;
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
                System::nanoTime, null);
    }

    @Test
    void timelineInvalidClockUnresolvedRejectsBeforeAnyLlmCall() {
        final TeamCase teamCase = teamResult(
                "arena-clock", "Ally", 1001L, 1, clockUnresolvedRecon());

        final AiTimelineUnusableException e = assertThrows(AiTimelineUnusableException.class,
                () -> service.analyzeTeam(teamCase.battle(), teamCase.recon(),
                        AllowedLanguage.ZH, AiReviewStreamListener.NOOP));

        assertTrue(e.getMessage().contains("AI_TIMELINE_UNUSABLE"), e.getMessage());
        assertTrue(e.getMessage().contains("TIMELINE_CLOCK_UNRESOLVED"), e.getMessage());
        assertTrue(gateway.requests.isEmpty(),
                "timeline invalid must reject before any LLM call (Call #1/Call #2 = 0): "
                        + gateway.requests);
    }

    @Test
    void noReconstructionRejectsBeforeAnyLlmCall() {
        final TeamCase teamCase = teamResult(
                "arena-norecon", "Ally", 1001L, 1, null);

        final AiTimelineUnusableException e = assertThrows(AiTimelineUnusableException.class,
                () -> service.analyzeTeam(teamCase.battle(), teamCase.recon(),
                        AllowedLanguage.ZH, AiReviewStreamListener.NOOP));

        assertTrue(e.getMessage().contains("AI_TIMELINE_UNUSABLE"), e.getMessage());
        assertTrue(e.getMessage().contains("NO_RECONSTRUCTION"), e.getMessage());
        assertTrue(gateway.requests.isEmpty(),
                "missing reconstruction must reject before any LLM call: " + gateway.requests);
    }

    @Test
    void validTimelineInjectedIntoTeamCall2Prompt() {
        final TeamCase teamCase = teamResult(
                "arena-valid", "Ally", 1001L, 1, validRecon());

        final AiReviewDonePayload result = service.analyzeTeam(teamCase.battle(), teamCase.recon(),
                AllowedLanguage.ZH, AiReviewStreamListener.NOOP);

        assertNotNull(result.analysis());
        final AiChatRequest call2 = gateway.requests.stream()
                .filter(r -> "SINGLE_TEAM_BATTLE".equals(r.analysisMode()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("no Call #2 request: " + gateway.requests));
        final String body = call2.userPrompt();
        assertTrue(body.contains("TACTICAL TIMELINE"), body);
        assertTrue(body.contains("EPISODE 1"), body);
        assertTrue(body.contains("战斗总时长: "), body);
        assertTrue(body.contains("=== GROUNDING FACTS"), "Call #2 输入必须注入 GROUNDING FACTS: " + body);
        assertTrue(gateway.requests.stream()
                .anyMatch(r -> "PRE_BATTLE_STRATEGIC_PRIOR".equals(r.analysisMode())),
                "Call #1 must run when timeline is valid: " + gateway.requests);
    }

    @Test
    void teamPromptBuilderDoesNotBuildTimelineItself() throws Exception {
        final Path classFile = Path.of(TeamAiPromptBuilder.class.getResource(
                "TeamAiPromptBuilder.class").toURI());
        final String classText = new String(Files.readAllBytes(classFile), StandardCharsets.ISO_8859_1);
        assertFalse(classText.contains("BattleTimelineBuilder"),
                "TeamAiPromptBuilder must not reference BattleTimelineBuilder (build happens once in orchestration)");
    }


    private record TeamCase(Battle battle, ReplayReconstruction recon) {
    }

    private static TeamCase teamResult(final String arenaId,
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
        return new TeamCase(battle, recon);
    }

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
        events.add(new DamageEvent(12, new ReplayTimestamp(START_RAW + 5f, null), 8,
                DecodeConfidence.EXACT, 1, 3, null, null, 420, false));
        return new ReplayReconstruction(meta, header, 120f, START_RAW, List.of(),
                events, List.of(), BattleStateSnapshot.empty(), coverage, diag);
    }

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
                    "{\"summary\":{\"verdict\":\"结论\",\"primaryDiagnosis\":\"诊断\"},"
                            + "\"episodes\":[],\"trainingSuggestions\":[],\"reviewFocus\":[],\"highContributors\":[]}",
                    "DeepSeek", "test-model",
                    0, 0, 0, 0, 0, 0, "stop");
        }
    }
}
