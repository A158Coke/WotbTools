package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.EngagementOutcome;
import com.wotb.core.replay.feature.EngagementSummary;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.MovementType;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
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
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SoloPlayIntentSkillTest {

    @Test
    void openingSpreadLabelsMapControlNotDetach() {
        final EvidenceSkillContext ctx = context(0, true, 0,
                List.of(move(5, 40, 200, 200, 200, 200, 1f)),
                List.of(), BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1015f, 1030f, 1045f},
                new float[]{200f, 200f, 200f}, new float[]{200f, 200f, 200f});

        final List<AiEvidence> evidence = SoloPlayIntentSkill.detect(ctx);

        assertEquals(1, evidence.size());
        assertEquals("OPENING_MAP_CONTROL", evidence.getFirst().labels().get("intent"));
    }

    @Test
    void lateDamageAndDeathDoNotSuppressEarlierOpeningMapControl() {
        // 玩家后期才掉血/阵亡：早期真实成立的开局图控仍应识别
        final EvidenceSkillContext ctx = context(1800, false, 200,
                List.of(move(5, 40, 200, 200, 200, 200, 1f)),
                List.of(), BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1015f, 1030f, 1045f},
                new float[]{200f, 200f, 200f}, new float[]{200f, 200f, 200f});

        final List<AiEvidence> evidence = SoloPlayIntentSkill.detect(ctx);

        assertEquals(1, evidence.size());
        assertEquals("OPENING_MAP_CONTROL", evidence.getFirst().labels().get("intent"));
    }

    @Test
    void stationaryHoldWithPressureLabelsDelayAndUnknownObjective() {
        final EvidenceSkillContext ctx = context(200, true, 0,
                List.of(stationary(60, 75, 200, 200)),
                List.of(engagement(60, 75, 200)),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1060f, 1075f},
                new float[]{200f, 200f}, new float[]{200f, 200f});

        final List<AiEvidence> evidence = SoloPlayIntentSkill.detect(ctx);

        assertEquals(1, evidence.size());
        assertEquals("SOLO_DELAY", evidence.getFirst().labels().get("intent"));
        // 地图语义 UNKNOWN：目标点关系为未知（-1），不得当作「远离目标点」
        assertEquals(-1.0, evidence.getFirst().numbers().get("objectiveProximity"));
    }

    @Test
    void movingPushWithInWindowDamageLabelsDetach() {
        final EvidenceSkillContext ctx = context(1800, true, 0,
                List.of(move(60, 75, 200, 200, 240, 240, 5f)),
                List.of(engagement(60, 75, 1800)),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1060f, 1075f},
                new float[]{200f, 240f}, new float[]{200f, 240f});

        final List<AiEvidence> evidence = SoloPlayIntentSkill.detect(ctx);

        assertEquals(1, evidence.size());
        assertEquals("SOLO_DETACHED", evidence.getFirst().labels().get("intent"));
        assertTrue(evidence.getFirst().numbers().get("distanceGrowthM") >= 20);
    }

    @Test
    void lateDeathOutsideSpanDoesNotLabelDetach() {
        // 后期阵亡（200s）不属于 [60,75] 窗口：不得把早期侧翼移动标成 SOLO_DETACHED
        final EvidenceSkillContext ctx = context(0, false, 200,
                List.of(move(60, 75, 200, 200, 240, 240, 5f)),
                List.of(),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1060f, 1075f},
                new float[]{200f, 240f}, new float[]{200f, 240f});

        final List<AiEvidence> evidence = SoloPlayIntentSkill.detect(ctx);

        assertTrue(evidence.isEmpty(), "death outside the window must not white-eat it");
    }

    @Test
    void missingMovementCoverageIsNotMoving() {
        // stationaryRatio == null（移动覆盖不足）≠ MOVING：有窗口内承伤也不判脱节
        final EvidenceSkillContext ctx = context(1800, true, 0,
                List.of(move(5, 10, 200, 200, 200, 200, 1f)),
                List.of(engagement(60, 75, 1800)),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1060f, 1075f},
                new float[]{200f, 240f}, new float[]{200f, 240f});

        final List<AiEvidence> evidence = SoloPlayIntentSkill.detect(ctx);

        assertTrue(evidence.isEmpty(), "unknown movement state must not be treated as MOVING");
    }

    @Test
    void noDistanceGrowthSuppressesDetach() {
        // 窗口内距离无增长：即使移动 + 承伤，也不生成 SOLO_DETACHED
        final EvidenceSkillContext ctx = context(1800, true, 0,
                List.of(move(60, 75, 200, 200, 200, 200, 5f)),
                List.of(engagement(60, 75, 1800)),
                BattlePhaseSummary.buildRelativePhases(60, 300),
                new float[]{1060f, 1075f},
                new float[]{200f, 200f}, new float[]{200f, 200f});

        final List<AiEvidence> evidence = SoloPlayIntentSkill.detect(ctx);

        assertTrue(evidence.isEmpty(), "no growth evidence -> no SOLO_DETACHED");
    }

    // ===== helpers =====

    private static EvidenceSkillContext context(
            final int recorderDamageReceived,
            final boolean recorderSurvived,
            final double recorderDeathSec,
            final List<MovementSegment> movements,
            final List<EngagementSummary> engagements,
            final List<BattlePhaseSummary> phases,
            final float[] rawClocks,
            final float[] recorderXs,
            final float[] recorderZs
    ) {
        final Battle battle = new Battle();
        battle.arenaId = "eval-arena";
        battle.mapName = "team_map";
        battle.arenaBonusType = 1;
        battle.durationS = 300.0;
        battle.recorder = "rec1";
        battle.players = new ArrayList<>();
        battle.players.add(player(1001L, "rec1", 1, recorderDamageReceived,
                recorderSurvived, recorderDeathSec));
        battle.players.add(player(1002L, "mate1", 1, 0, true, 0));
        battle.players.add(player(2001L, "enemy1", 2, 0, true, 0));

        final List<BattleStateCheckpoint> checkpoints = new ArrayList<>();
        for (int index = 0; index < rawClocks.length; index++) {
            checkpoints.add(cp(rawClocks[index], recorderXs[index], recorderZs[index]));
        }
        final ReplayMetadata meta = new ReplayMetadata(
                "eval-arena", "team_map", "11.0", "11.0", 1, "rec1", "", 300.0, 0L);
        final ReplayStreamHeader header = new ReplayStreamHeader(
                0x12345678L, new byte[8], "h", "v", 15);
        final ReplayCoverage coverage = new ReplayCoverage(
                true, rawClocks.length, rawClocks.length, 0, 0, 0, 1.0, Map.of());
        final ReplayStreamDiagnostics diag = new ReplayStreamDiagnostics(
                0, 0, 0, 0, 0, 0, 0, 0, 0f, 0f, 0, Map.of(), true, 1000f, true);
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
                movements, engagements, phases, List.of(), List.of(), true);
        return new EvidenceSkillContext(battle, recon, features, recorder);
    }

    private static BattleStateCheckpoint cp(final float rawClockSec,
                                            final float recorderX, final float recorderZ) {
        final Map<Integer, VehicleState> vehicles = new HashMap<>();
        vehicles.put(1, vehicle(1, 1001L, 1, recorderX, recorderZ));
        vehicles.put(2, vehicle(2, 1002L, 1, 0f, 0f));
        vehicles.put(3, vehicle(3, 1003L, 1, 0f, 0f));
        return new BattleStateCheckpoint(rawClockSec, 0,
                new BattleStateSnapshot(rawClockSec, rawClockSec - 1000f,
                        BattleLifecycle.IN_PROGRESS, vehicles, Map.of(), List.of(), false, null));
    }

    private static VehicleState vehicle(final int entityId, final long accountId,
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

    private static PlayerResult player(final long accountId, final String nickname,
                                       final int team, final int damageReceived,
                                       final boolean survived, final double deathSec) {
        final PlayerResult player = new PlayerResult();
        player.accountId = accountId;
        player.nickname = nickname;
        player.team = team;
        player.tankId = 4481L;
        player.damageReceived = damageReceived;
        player.survived = survived;
        player.deathTimeMillis = deathSec > 0 ? (long) (deathSec * 1000) : 0L;
        return player;
    }

    private static MovementSegment move(final float start, final float end,
                                        final float x1, final float z1,
                                        final float x2, final float z2, final float speed) {
        final float distance = (float) Math.hypot(x2 - x1, z2 - z1);
        return new MovementSegment(start, end, MovementType.MOVING,
                new Vector3(x1, 0f, z1), new Vector3(x2, 0f, z2),
                distance, speed, DecodeConfidence.EXACT);
    }

    private static MovementSegment stationary(final float start, final float end,
                                              final float x, final float z) {
        return new MovementSegment(start, end, MovementType.STATIONARY,
                new Vector3(x, 0f, z), new Vector3(x, 0f, z), 0f, 0f, DecodeConfidence.EXACT);
    }

    private static EngagementSummary engagement(final float start, final float end,
                                                final int damageReceived) {
        return new EngagementSummary(start, end, List.of(1001L), List.of(2001L),
                300, damageReceived, new Vector3(200f, 0f, 200f), new Vector3(200f, 0f, 200f),
                EngagementOutcome.UNFAVORABLE, DecodeConfidence.PARTIAL);
    }
}
