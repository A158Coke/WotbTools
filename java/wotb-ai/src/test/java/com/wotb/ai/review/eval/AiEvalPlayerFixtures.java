package com.wotb.ai.review.eval;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.evidence.TeamSeparationEvidenceSkill;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.EngagementSummary;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.processing.RecorderEntityMapping;
import com.wotb.core.replay.reconstruction.BattleLifecycle;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.LifeState;
import com.wotb.core.replay.reconstruction.ObservationState;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayMetadata;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayStreamDiagnostics;
import com.wotb.core.replay.reconstruction.ReplayStreamHeader;
import com.wotb.core.replay.reconstruction.Vector3;
import com.wotb.core.replay.reconstruction.VehicleState;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.move;
import static com.wotb.ai.review.eval.AiEvalTeamFixtureSupport.stationary;

/** Builds synthetic single-player replay evidence for deterministic AI evaluation tests. */
final class AiEvalPlayerFixtures {
    record PlayerFixture(
            Battle battle,
            ReplayReconstruction recon,
            PlayerBattleFeatureSet features,
            RecorderEntityMapping recorder
    ) {
    }

    private AiEvalPlayerFixtures() {
    }

    static PlayerFixture playerFixture(final String fixtureKey) {
        return switch (fixtureKey) {
            case "player-opening-mapcontrol-01" -> playerOpeningMapControl();
            case "player-delay-hold-01" -> playerDelayHold();
            case "player-detach-push-01" -> playerDetachPush();
            case "player-no-growth-01" -> playerNoGrowth();
            case "player-unknown-stationary-01" -> playerUnknownStationary();
            case "player-opening-contact-01" -> playerOpeningContact();
            case "player-thin-coverage-01" -> playerThinCoverage();
            case "player-partial-overlap-strong-signals-01" -> playerPartialOverlapStrongSignals();
            case "player-damage-partial-opening-01" -> playerDamagePartialOpening();
            default -> throw new IllegalArgumentException("Unknown player fixture: " + fixtureKey);
        };
    }

    /** 随机战开局分散（中性 signal）：录像者开局散开、未接火未阵亡 → OPENING_SPREAD。 */
    private static PlayerFixture playerOpeningMapControl() {
        return playerFixtureOf(
                0, true,
                List.of(move(5, 40, 0, 0, 100, 150, 6f)),
                List.of(),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1015f, 1030f, 1045f},
                new float[]{200f, 200f, 200f},
                new float[]{200f, 200f, 200f});
    }

    /** 随机战静止分离：录像者静止 + 敌情压力（中性分离窗口；是否拖延由 LLM 判断）。 */
    private static PlayerFixture playerDelayHold() {
        return playerFixtureOf(
                200, true,
                List.of(stationary(60, 75, 100, 150)),
                List.of(playerEngagement(60, 75)),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1060f, 1075f},
                new float[]{200f, 200f},
                new float[]{200f, 200f});
    }

    /** 随机战移动分离 + 承伤高（中性分离窗口；是否脱节由 LLM 判断）。 */
    private static PlayerFixture playerDetachPush() {
        return playerFixtureOf(
                1800, true,
                List.of(move(60, 75, 200, 200, 240, 240, 5f)),
                List.of(playerEngagement(60, 75, 1800)),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1060f, 1075f},
                new float[]{200f, 240f},
                new float[]{200f, 240f});
    }

    /** 随机战 false-positive：窗口内移动但距离无增长 + 承伤 → 不应判脱节。 */
    private static PlayerFixture playerNoGrowth() {
        return playerFixtureOf(
                1800, true,
                List.of(move(60, 75, 200, 200, 200, 200, 5f)),
                List.of(playerEngagement(60, 75, 1800)),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1060f, 1075f},
                new float[]{200f, 200f},
                new float[]{200f, 200f});
    }

    /** 随机战 false-positive：窗口内移动覆盖不足（未知）≠ MOVING → 不应判任何候选。 */
    private static PlayerFixture playerUnknownStationary() {
        return playerFixtureOf(
                1800, true,
                List.of(move(5, 10, 200, 200, 200, 200, 1f)),
                List.of(playerEngagement(60, 75, 1800)),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1060f, 1075f},
                new float[]{200f, 200f},
                new float[]{200f, 200f});
    }

    /** éšæœºæˆ˜ false-positiveï¼šå¼€å±€çª—å£å†…æœ‰äº¤ç«ï¼ˆçª—å£å†…æ‰¿ä¼¤>0ï¼‰â†’ ä¸å¾—åˆ¤å¼€å±´å›¾æŽ§ã€‚ */
    private static PlayerFixture playerOpeningContact() {
        return playerFixtureOf(
                200, true,
                List.of(move(5, 40, 0, 0, 100, 150, 6f)),
                List.of(playerEngagement(5, 40, 200)),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1015f, 1030f, 1045f},
                new float[]{200f, 200f, 200f},
                new float[]{200f, 200f, 200f});
    }

    /** éšæœºæˆ˜ false-positiveï¼šçª—å£å†…ç§»åŠ¨è¦†ç›–æžä½Žï¼ˆ1s/15sï¼‰â‰  MOVINGï¼Œå³³ä½¿çª—å£å†…æ‰¿ä¼¤ 1800 ä¹Ÿä¸åˆ¤è„±èŠ‚ã€‚ */
    private static PlayerFixture playerThinCoverage() {
        return playerFixtureOf(
                1800, true,
                List.of(move(60, 61, 200, 200, 200, 200, 5f)),
                List.of(playerEngagement(60, 75, 1800)),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1060f, 1065f, 1075f},
                new float[]{200f, 200f, 240f},
                new float[]{200f, 200f, 240f});
    }

    /** éšæœºæˆ˜ false-positiveï¼šå½•åƒè€…éƒ¨åˆ†é‡å äº¤ç«ï¼ˆ40-65sï¼‰+ çª—å£å†…æ‰¿ä¼¤ 1000 + æ‹‰å¤§è·ç¦» â†’ ä¸å¾—ç¡¬ç”Ÿæˆè„±èŠ‚/æ‹–å»¶ã€‚ */
    private static PlayerFixture playerPartialOverlapStrongSignals() {
        return playerFixtureOf(
                0, true,
                List.of(move(60, 75, 200, 200, 240, 240, 5f)),
                List.of(playerEngagement(40, 65, 1000)),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1060f, 1065f, 1075f},
                new float[]{200f, 200f, 240f},
                new float[]{200f, 200f, 240f});
    }

    /** éšæœºæˆ˜ false-positiveï¼šOBSERVED_DAMAGE_IS_PARTIAL + å¼€å±´æœªè§‚å¯Ÿåˆ°äº¤ç« â†’ ä¸å¾—ç”¨â€œæ²¡æœ‰è§‚å¯Ÿåˆ°â€è¯æ˜ŽæœªæŽ¥ç«ã€‚ */
    private static PlayerFixture playerDamagePartialOpening() {
        return playerFixtureOf(
                0, true,
                List.of(move(5, 40, 0, 0, 100, 150, 6f)),
                List.of(),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1015f, 1030f, 1045f},
                new float[]{200f, 200f, 200f},
                new float[]{200f, 200f, 200f},
                List.of(TeamSeparationEvidenceSkill.OBSERVED_DAMAGE_IS_PARTIAL));
    }

    private static PlayerFixture playerFixtureOf(
            final int recorderDamageReceived,
            final boolean recorderSurvived,
            final List<MovementSegment> movements,
            final List<EngagementSummary> engagements,
            final List<BattlePhaseSummary> phases,
            final float[] rawClocks,
            final float[] recorderXs,
            final float[] recorderZs
    ) {
        return playerFixtureOf(recorderDamageReceived, recorderSurvived, movements,
                engagements, phases, rawClocks, recorderXs, recorderZs, List.of());
    }

    private static PlayerFixture playerFixtureOf(
            final int recorderDamageReceived,
            final boolean recorderSurvived,
            final List<MovementSegment> movements,
            final List<EngagementSummary> engagements,
            final List<BattlePhaseSummary> phases,
            final float[] rawClocks,
            final float[] recorderXs,
            final float[] recorderZs,
            final List<String> limitations
    ) {
        final Battle battle = new Battle();
        battle.arenaId = "eval-arena";
        battle.mapName = "team_map";
        battle.arenaBonusType = 1;
        battle.durationS = 300.0;
        battle.recorder = "rec1";
        battle.players = new ArrayList<>();
        battle.players.add(playerResult(1001L, "rec1", 1, recorderDamageReceived, recorderSurvived));
        battle.players.add(playerResult(1002L, "mate1", 1, 0, true));
        battle.players.add(playerResult(2001L, "enemy1", 2, 0, true));

        final List<BattleStateCheckpoint> checkpoints = new ArrayList<>();
        for (int index = 0; index < rawClocks.length; index++) {
            checkpoints.add(playerCheckpoint(rawClocks[index], recorderXs[index], recorderZs[index]));
        }
        final ReplayMetadata meta = new ReplayMetadata(
                "eval-arena", "team_map", "11.0", "11.0", 1, "rec1", "", 300.0, 0L);
        final ReplayStreamHeader header = new ReplayStreamHeader(
                0x12345678L, new byte[8], "h", "v", 15);
        final ReplayCoverage coverage = new ReplayCoverage(rawClocks.length, rawClocks.length, 0, 0, 0, 1.0, Map.of());
        final ReplayStreamDiagnostics diag = new ReplayStreamDiagnostics(0, 0, 0f, 0f, 0, Map.of());
        final List<com.wotb.core.replay.event.ReplayEvent> events = List.of(
                new ParticipantMappingEvent(
                        0, new ReplayTimestamp(1000f, 0f), 8, DecodeConfidence.EXACT, 1, 1001L),
                new DamageEvent(
                        1, new ReplayTimestamp(1010f, 10f), 8, DecodeConfidence.EXACT,
                        1, 4, null, null, 420, false));
        final ReplayReconstruction recon = new ReplayReconstruction(
                meta, header, 300f, 1000f,
                List.of(new BattleParticipant(1001L, "rec1", 1, 4481, "Kranvagn", true)),
                events, checkpoints, checkpoints.getLast().stateSnapshot(), coverage, diag);
        final RecorderEntityMapping recorder = new RecorderEntityMapping(
                1001L, 1, 1, "rec1", 1, 4481, DecodeConfidence.EXACT);
        final PlayerBattleFeatureSet features = new PlayerBattleFeatureSet(
                movements, engagements, phases, List.of(), limitations, true);
        return new PlayerFixture(battle, recon, features, recorder);
    }

    private static BattleStateCheckpoint playerCheckpoint(final float rawClockSec,
                                                          final float recorderX,
                                                          final float recorderZ) {
        final Map<Integer, VehicleState> vehicles = new HashMap<>();
        vehicles.put(1, vehicleState(1, 1001L, 1, recorderX, recorderZ));
        vehicles.put(2, vehicleState(2, 1002L, 1, 0f, 0f));
        vehicles.put(3, vehicleState(3, 1003L, 1, 0f, 0f));
        return new BattleStateCheckpoint(rawClockSec, 0,
                new BattleStateSnapshot(rawClockSec, rawClockSec - 1000f,
                        BattleLifecycle.IN_PROGRESS, vehicles, Map.of(), List.of(), false, null));
    }

    private static VehicleState vehicleState(final int entityId, final long accountId,
                                             final int team, final float x, final float z) {
        final VehicleState vehicle = new VehicleState(entityId, 0f);
        vehicle.setAccountId(accountId);
        vehicle.setTeam(team);
        vehicle.setPosition(new Vector3(x, 0f, z));
        vehicle.setCurrentHealth(1000);
        vehicle.setMaxHealth(1000);
        vehicle.setLifeState(LifeState.ALIVE);
        vehicle.setObservationState(ObservationState.OBSERVED);
        return vehicle;
    }

    private static PlayerResult playerResult(final long accountId, final String nickname,
                                             final int team, final int damageReceived,
                                             final boolean survived) {
        final PlayerResult player = new PlayerResult();
        player.accountId = accountId;
        player.nickname = nickname;
        player.team = team;
        player.tankId = 4481L;
        player.damageReceived = damageReceived;
        player.survived = survived;
        return player;
    }

    private static EngagementSummary playerEngagement(final float start, final float end) {
        return playerEngagement(start, end, 200);
    }

    private static EngagementSummary playerEngagement(final float start, final float end,
                                                      final int damageReceived) {
        // 生产形态：DefaultPlayerBattleFeatureExtractor 构造的 player engagement 敌我 account 列表为空
        return new EngagementSummary(start, end, List.of(), List.of(),
                300, damageReceived, new Vector3(100f, 0f, 150f), new Vector3(100f, 0f, 150f),
                DecodeConfidence.PARTIAL);
    }
}
