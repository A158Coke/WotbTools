package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.EngagementOutcome;
import com.wotb.core.replay.feature.EngagementSummary;
import com.wotb.core.replay.feature.MapRegionResolver;
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

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** Evidence Skill 测试共享 fixture。 */
final class EvidenceTestFixtures {

    static final float START_RAW = 1000f;

    private EvidenceTestFixtures() {
    }

    static PlayerResult player(final long accountId, final int team, final long tankId,
                               final String tankName, final boolean survived, final double deathSec) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.team = team;
        p.tankId = tankId;
        p.tankName = tankName;
        p.survived = survived;
        p.deathTimeMillis = survived ? 0 : (long) (deathSec * 1000);
        p.survivalTimeSec = survived ? 300.0 : deathSec;
        p.damageDealt = 100;
        p.damageReceived = 100;
        return p;
    }

    static Battle battle(final List<PlayerResult> players) {
        final Battle b = new Battle();
        b.mapName = "middleburg";
        b.arenaBonusType = 1;
        b.durationS = 300.0;
        b.players = players;
        return b;
    }

    static VehicleState vehicle(final int entityId, final long accountId, final int team,
                                final int tankId, final float x, final float z, final int hp) {
        final VehicleState vs = new VehicleState(entityId, 0f);
        vs.setAccountId(accountId);
        vs.setTeam(team);
        vs.setTankId(tankId);
        vs.setPosition(new Vector3(x, 0f, z));
        vs.setCurrentHealth(hp);
        vs.setMaxHealth(hp);
        vs.setLifeState(LifeState.ALIVE);
        vs.setObservationState(ObservationState.OBSERVED);
        return vs;
    }

    static VehicleState hiddenVehicle(final int entityId, final long accountId, final int team) {
        final VehicleState vs = new VehicleState(entityId, 0f);
        vs.setAccountId(accountId);
        vs.setTeam(team);
        vs.setObservationState(ObservationState.UNKNOWN);
        return vs;
    }

    /** confirmed DESTROYED（LifeState.DESTROYED + REMOVED，0 HP）——可靠终态。 */
    static VehicleState destroyedVehicle(final int entityId, final long accountId, final int team) {
        final VehicleState vs = new VehicleState(entityId, 0f);
        vs.setAccountId(accountId);
        vs.setTeam(team);
        vs.setLifeState(LifeState.DESTROYED);
        vs.setObservationState(ObservationState.REMOVED);
        vs.setCurrentHealth(0);
        return vs;
    }

    static BattleStateCheckpoint cp(final float raw, final VehicleState... vehicles) {
        final Map<Integer, VehicleState> map = new HashMap<>();
        for (final VehicleState vs : vehicles) {
            map.put(vs.entityId(), vs);
        }
        return new BattleStateCheckpoint(
                raw,
                0,
                new BattleStateSnapshot(
                        raw,
                        raw - START_RAW,
                        BattleLifecycle.IN_PROGRESS,
                        map,
                        Map.of(),
                        List.of(),
                        false,
                        null));
    }

    static ReplayReconstruction recon(final BattleStateCheckpoint... checkpoints) {
        return reconWithEvents(checkpoints == null ? List.of() : List.of(checkpoints));
    }

    static ReplayReconstruction reconWithEvents(final List<BattleStateCheckpoint> checkpoints) {
        final ReplayMetadata meta = new ReplayMetadata(
                "arena", "middleburg", "1", "1", 1, "rec1", "", 300.0, 0L);
        final ReplayStreamHeader header = new ReplayStreamHeader(
                0x12345678L, new byte[8], "h", "v", 15);
        final ReplayCoverage coverage = new ReplayCoverage(
                true, 1, 1, 0, 0, 0, 1.0, Map.of());
        final ReplayStreamDiagnostics diag = new ReplayStreamDiagnostics(
                0, 0, 0, 0, 0, 0, 0, 0, 0f, 0f, 0, Map.of(),
                true, START_RAW, true);
        final BattleStateSnapshot finalState = checkpoints.isEmpty()
                ? BattleStateSnapshot.empty() : checkpoints.getLast().stateSnapshot();
        return new ReplayReconstruction(
                meta, header, 300f, START_RAW,
                List.of(new BattleParticipant(1001, "rec1", 1, 4481, "Kranvagn", true)),
                List.of(),
                checkpoints,
                finalState,
                coverage,
                diag);
    }

    static RecorderEntityMapping recorder() {
        return new RecorderEntityMapping(1001L, 4481, 1, "rec1", 1, 4481, DecodeConfidence.EXACT);
    }

    static PlayerBattleFeatureSet features(final List<EngagementSummary> engagements) {
        return new PlayerBattleFeatureSet(
                List.of(), engagements, List.of(), List.of(), List.of(), true);
    }

    static EngagementSummary engagement(final float start, final float end,
                                         final int dealt, final int received) {
        return new EngagementSummary(
                start, end, List.of(), List.of(),
                dealt, received,
                new Vector3(0, 0, 0), new Vector3(0, 0, 0),
                EngagementOutcome.EVEN, DecodeConfidence.EXACT);
    }

    static MovementSegment movement(final float start, final float end,
                                    final Vector3 from, final Vector3 to) {
        return new MovementSegment(
                start, end, MovementType.MOVING, from, to,
                MapRegionResolver.canonicalDistanceMeters(from.x(), from.z(), to.x(), to.z()),
                10f, DecodeConfidence.EXACT);
    }
}
