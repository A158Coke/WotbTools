package com.wotb.web.replay.ai;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.BattleLifecycle;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.LifeState;
import com.wotb.core.replay.reconstruction.ObservationState;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayMetadata;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.VehicleState;
import com.wotb.core.replay.reconstruction.Vector3;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;
import com.wotb.core.replay.stream.ReplayStreamHeader;
import com.wotb.web.replay.ai.gateway.AiChatGateway;
import com.wotb.web.replay.ai.gateway.AiChatRequest;
import com.wotb.web.replay.ai.gateway.AiChatResponse;
import com.wotb.web.replay.ai.gateway.AiReplayAnalysisConfig;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.LongSupplier;

class TacticalReviewHarnessTest {

    private static final AiTokenEstimator ESTIMATOR = new ConservativeDeepSeekTokenEstimator();

    private static final String PRIOR_JSON = """
            {
              "teamA": {"composition": {"mobility": "HIGH"}, "strengths": ["s1"], "weaknesses": ["w1"], "preferredPlans": ["p1"]},
              "teamB": {"composition": {"mobility": "MEDIUM"}, "strengths": ["s2"], "weaknesses": ["w2"], "preferredPlans": ["p2"]},
              "keyMatchups": [{"area": "GRID_REGION_5", "advantage": "TEAM_A", "reason": "r"}],
              "strategicWinConditions": [{"team": "TEAM_A", "condition": "c"}],
              "hypotheses": [{"id": "H1", "claim": "cl", "reason": "rs"}]
            }""";

    private static AiReplayAnalysisConfig config() {
        return new AiReplayAnalysisConfig(
                ESTIMATOR, "test-model", 100_000, 131_072, 8192, 1000, false, null, 315);
    }

    private static TacticalReviewHarness harness(final AiChatGateway gateway) {
        return harness(gateway, System::nanoTime);
    }

    private static TacticalReviewHarness harness(final AiChatGateway gateway,
                                                 final LongSupplier clock) {
        final PlayerReplayAnalysisService playerService = new PlayerReplayAnalysisService(gateway, config());
        final PreBattleStrategicService preBattleService = new PreBattleStrategicService(gateway, config());
        return new TacticalReviewHarness(playerService, preBattleService, gateway, config(), clock);
    }

    private static AiChatGateway gateway(final String preBattleReply) {
        return recordingGateway(preBattleReply, null);
    }

    private static RecordingGateway recordingGateway(final String preBattleReply,
                                                     final Runnable preBattleAdvance) {
        return new RecordingGateway(preBattleReply, preBattleAdvance);
    }

    /** 可记录请求、可在 Call #1 返回前推进假时钟的测试网关。 */
    private static final class RecordingGateway implements AiChatGateway {
        private final String preBattleReply;
        private final Runnable preBattleAdvance;
        AiChatRequest lastHarnessRequest;

        RecordingGateway(final String preBattleReply, final Runnable preBattleAdvance) {
            this.preBattleReply = preBattleReply;
            this.preBattleAdvance = preBattleAdvance;
        }

        @Override
        public AiChatResponse chat(final AiChatRequest request) {
            if (request.userPrompt().contains("TEAM_A（队伍1）阵容")) {
                if (preBattleAdvance != null) {
                    preBattleAdvance.run();
                }
                return new AiChatResponse(preBattleReply, "", "", 0, 0, 0, 0, 0, 0, "stop");
            }
            if ("TACTICAL_REVIEW_HARNESS".equals(request.analysisMode())) {
                lastHarnessRequest = request;
                return new AiChatResponse("harness-review-text", "", "", 0, 0, 0, 0, 0, 0, "stop");
            }
            return new AiChatResponse("old-path-text", "", "", 0, 0, 0, 0, 0, 0, "stop");
        }

        @Override
        public boolean isConfigured() {
            return true;
        }
    }

    private static Battle battle() {
        final List<PlayerResult> players = List.of(
                resultPlayer(1001, 1, 4481, "Kranvagn", "rec1", true, 0),
                resultPlayer(1002, 1, 10785, "T110E5", "", false, 100),
                resultPlayer(1003, 1, 10785, "T110E5", "", false, 108),
                resultPlayer(2001, 2, 14609, "Leopard 1", "", true, 0),
                resultPlayer(2002, 2, 12305, "E 50 M", "", true, 0));
        final Battle b = new Battle();
        b.mapName = "middleburg";
        b.arenaBonusType = 1;
        b.durationS = 300.0;
        b.recorder = "rec1";
        b.players = new java.util.ArrayList<>(players);
        return b;
    }

    private static PlayerResult resultPlayer(final long accountId, final int team,
                                             final long tankId, final String tankName,
                                             final String nickname, final boolean survived,
                                             final double deathSec) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.team = team;
        p.tankId = tankId;
        p.tankName = tankName;
        p.nickname = nickname;
        p.survived = survived;
        p.deathTimeMillis = survived ? 0 : (long) (deathSec * 1000);
        p.survivalTimeSec = survived ? 300.0 : deathSec;
        p.damageDealt = 500;
        p.damageReceived = 400;
        return p;
    }

    private static ReplayReconstruction recon() {
        final ReplayMetadata meta = new ReplayMetadata(
                "arena", "middleburg", "1", "1", 1, "rec1", "", 300.0, 0L);
        final ReplayStreamHeader header = new ReplayStreamHeader(
                0x12345678L, new byte[8], "h", "v", 15);
        final ReplayCoverage coverage = new ReplayCoverage(
                true, 2, 2, 0, 0, 0, 1.0, Map.of());
        final ReplayStreamDiagnostics diag = new ReplayStreamDiagnostics(
                0, 0, 0, 0, 0, 0, 0, 0, 0f, 0f, 0, Map.of(),
                true, 1000f, true);
        final List<com.wotb.core.replay.event.ReplayEvent> events = List.of(
                new ParticipantMappingEvent(
                        0, new ReplayTimestamp(1000f, 0f), 8, DecodeConfidence.EXACT, 1, 1001),
                new DamageEvent(
                        1, new ReplayTimestamp(1010f, 10f), 8, DecodeConfidence.EXACT,
                        1, 4, null, null, 420, false));
        final List<BattleStateCheckpoint> checkpoints = List.of(
                cp(1000f, 1, 1001, 1, 1000, 0f, 0f),
                cp(1010f, 1, 1001, 1, 1000, 0f, 0f),
                cp(1020f, 1, 1001, 1, 900, 0f, 0f));
        return new ReplayReconstruction(
                meta, header, 300f, 1000f,
                List.of(new BattleParticipant(1001, "rec1", 1, 4481, "Kranvagn", true)),
                events,
                checkpoints,
                checkpoints.getLast().stateSnapshot(),
                coverage,
                diag);
    }

    private static BattleStateCheckpoint cp(final float raw, final int entityId,
                                            final long accountId, final int team,
                                            final int hp, final float x, final float z) {
        final Map<Integer, VehicleState> vehicles = new HashMap<>();
        final VehicleState vs = new VehicleState(entityId, 0f);
        vs.setAccountId(accountId);
        vs.setTeam(team);
        vs.setPosition(new Vector3(x, 0f, z));
        vs.setCurrentHealth(hp);
        vs.setMaxHealth(hp);
        vs.setLifeState(LifeState.ALIVE);
        vs.setObservationState(ObservationState.OBSERVED);
        vehicles.put(entityId, vs);
        return new BattleStateCheckpoint(
                raw, 0,
                new BattleStateSnapshot(
                        raw, raw - 1000f, BattleLifecycle.IN_PROGRESS,
                        vehicles, Map.of(), List.of(), false, null));
    }

    private static ReplayProcessingResult result(final ReplayReconstruction reconstruction) {
        return new ReplayProcessingResult(
                "f.wotbreplay", null, null, battle(), reconstruction, null, null, null, null);
    }

    @Test
    void fullHarnessUsedWhenAllInputsAvailable() {
        final AnalyzeResult result = harness(gateway(PRIOR_JSON))
                .analyze(result(recon()), AllowedLanguage.ZH);
        assertEquals("harness-review-text", result.analysis());
    }

    @Test
    void noReconstructionFallsBackToOldPath() {
        final AnalyzeResult result = harness(gateway(PRIOR_JSON))
                .analyze(result(null), AllowedLanguage.ZH);
        assertEquals("old-path-text", result.analysis());
    }

    @Test
    void nonZhFallsBackToOldPath() {
        final AnalyzeResult result = harness(gateway(PRIOR_JSON))
                .analyze(result(recon()), AllowedLanguage.EN);
        assertEquals("old-path-text", result.analysis());
    }

    @Test
    void unparsablePreBattlePriorFallsBackToOldPath() {
        final AnalyzeResult result = harness(gateway("not a json object"))
                .analyze(result(recon()), AllowedLanguage.ZH);
        assertEquals("old-path-text", result.analysis());
    }

    @Test
    void call1FastSuccessLeavesCall2WithinOverallBudget() {
        final RecordingGateway gateway = recordingGateway(PRIOR_JSON, null);
        final AtomicLong clock = new AtomicLong(0L);
        final AnalyzeResult result = harness(gateway, clock::get)
                .analyze(result(recon()), AllowedLanguage.ZH);

        assertEquals("harness-review-text", result.analysis());
        assertNotNull(gateway.lastHarnessRequest);
        assertNotNull(gateway.lastHarnessRequest.callTimeoutSec(),
                "Call #2 must carry an explicit stage budget");
        assertTrue(gateway.lastHarnessRequest.callTimeoutSec() > 0);
        assertTrue(gateway.lastHarnessRequest.callTimeoutSec()
                        <= config().callTimeoutSec() - TacticalReviewHarness.SAFETY_MARGIN_SEC,
                "Call #2 budget must leave the overall safety margin");
    }

    @Test
    void call1ConsumingNearlyAllBudgetDoesNotStartFallback() {
        final AtomicLong clock = new AtomicLong(0L);
        // Call #1 消耗 270s：剩余 45s < FALLBACK_MIN_REMAINING_SEC，禁止再启动最长 315s 的 fallback
        final RecordingGateway gateway = recordingGateway(
                "not a json object", () -> clock.addAndGet(270_000_000_000L));
        final TacticalReviewHarness harness = harness(gateway, clock::get);

        final com.wotb.web.replay.ai.gateway.AiUpstreamException e = assertThrows(
                com.wotb.web.replay.ai.gateway.AiUpstreamException.class,
                () -> harness.analyze(result(recon()), AllowedLanguage.ZH));

        assertEquals("AI_TIMEOUT", e.code());
        assertNull(gateway.lastHarnessRequest, "Call #2 must not run when the overall budget is gone");
    }

    @Test
    void sequentialTheoreticalTimeoutNeverExceedsEndpointDeadline() {
        // Call #1(45s) + 旧路径 fallback(≤315s) 的理论最坏值必须低于前端/nginx 的 400s
        assertTrue(TacticalReviewHarness.CALL_1_BUDGET_SEC + config().callTimeoutSec()
                < TacticalReviewHarness.ENDPOINT_DEADLINE_SEC);
    }
}
