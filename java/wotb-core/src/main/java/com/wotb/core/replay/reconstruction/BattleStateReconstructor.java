package com.wotb.core.replay.reconstruction;

import com.wotb.core.replay.event.BattleEndedEvent;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.EntityCreatedEvent;
import com.wotb.core.replay.event.EntityRemovedEvent;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.HpRawState;
import com.wotb.core.replay.event.MaterializationEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.RecorderHealthChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.VehicleHealthStateEvent;
import com.wotb.core.replay.event.VehicleDestroyedEvent;

import java.util.ArrayList;
import java.util.List;

/** 按领域事件重建战场状态；只消费 canonical world-position / HP / terminal semantics。 */
public class BattleStateReconstructor {

    static final float DEFAULT_CHECKPOINT_INTERVAL_SEC = 1.0f;
    static final int DEFAULT_CHECKPOINT_EVENT_INTERVAL = 500;

    private final float checkpointIntervalSec;
    private final int checkpointEventInterval;
    private final Float battleStartRawClockSec;

    public BattleStateReconstructor(
            final Float battleStartRawClockSec,
            final float checkpointIntervalSec,
            final int checkpointEventInterval) {
        this.battleStartRawClockSec = battleStartRawClockSec;
        this.checkpointIntervalSec = checkpointIntervalSec;
        this.checkpointEventInterval = checkpointEventInterval;
    }

    public BattleStateReconstructor() {
        this(null, DEFAULT_CHECKPOINT_INTERVAL_SEC, DEFAULT_CHECKPOINT_EVENT_INTERVAL);
    }

    public ReconstructionResult reconstruct(final List<ReplayEvent> events) {
        final BattleState state = new BattleState();
        final List<ReplayEvent> processedEvents = new ArrayList<>();
        final List<BattleStateCheckpoint> checkpoints = new ArrayList<>();
        float lastCheckpointClock = -Float.MAX_VALUE;
        int lastCheckpointEventIndex = 0;

        checkpoints.add(new BattleStateCheckpoint(0f, 0, BattleStateSnapshot.from(state)));
        for (final ReplayEvent event : events) {
            applyEvent(state, event);
            processedEvents.add(event);
            final float rawClockSec = event.timestamp().rawClockSec();
            state.setRawClockSec(rawClockSec);
            if (battleStartRawClockSec != null) {
                state.setBattleClockSec(rawClockSec - battleStartRawClockSec);
            }
            final boolean timeBased = rawClockSec - lastCheckpointClock >= checkpointIntervalSec;
            final boolean eventBased = processedEvents.size() - lastCheckpointEventIndex >= checkpointEventInterval;
            if (timeBased || eventBased) {
                checkpoints.add(new BattleStateCheckpoint(rawClockSec, processedEvents.size(),
                        BattleStateSnapshot.from(state)));
                lastCheckpointClock = rawClockSec;
                lastCheckpointEventIndex = processedEvents.size();
            }
        }
        final BattleStateSnapshot finalSnapshot = BattleStateSnapshot.from(state);
        if (checkpoints.isEmpty() || checkpoints.getLast().eventIndex() < processedEvents.size()) {
            checkpoints.add(new BattleStateCheckpoint(state.getRawClockSec(), processedEvents.size(), finalSnapshot));
        }
        return new ReconstructionResult(state, finalSnapshot, processedEvents, checkpoints);
    }

    private void applyEvent(final BattleState state, final ReplayEvent event) {
        switch (event) {
            case PositionChangedEvent e -> applyPosition(state, e);
            case DamageEvent e -> applyDamage(state, e);
            case EntityRemovedEvent e -> applyEntityRemoved(state, e);
            case VehicleDestroyedEvent e -> applyVehicleDestroyed(state, e);
            case BattleEndedEvent e -> applyBattleEnded(state, e);
            case HealthChangedEvent e -> applyHealth(state, e);
            case MaterializationEvent e -> applyMaterialization(state, e);
            case RecorderHealthChangedEvent e -> applyRecorderHealth(state, e);
            case VehicleHealthStateEvent e -> applyVehicleHealthState(state, e);
            case EntityCreatedEvent e -> applyEntityCreated(state, e);
            case ParticipantMappingEvent e -> applyMapping(state, e);
            default -> { }
        }
    }

    private void applyPosition(final BattleState state, final PositionChangedEvent e) {
        final VehicleState vs = state.getOrCreateVehicle(e.entityId(), e.timestamp().rawClockSec());
        vs.setLastObservedAt(e.timestamp().rawClockSec());
        if (vs.lifeState() == LifeState.DESTROYED && DecodeConfidenceHelper.isLowConfidence(e.confidence())) {
            return;
        }
        try {
            vs.setPosition(new Vector3(e.x(), e.y(), e.z()));
        } catch (IllegalArgumentException ignored) { }
        try {
            vs.setRotation(new Rotation(e.yaw(), e.pitch(), e.roll()));
        } catch (IllegalArgumentException ignored) { }
        if (vs.observationState() == ObservationState.UNKNOWN
                || vs.observationState() == ObservationState.REMOVED) {
            vs.setObservationState(ObservationState.OBSERVED);
        }
    }

    private void applyDamage(final BattleState state, final DamageEvent e) {
        if (e.attackerEid() != e.victimEid()) {
            final VehicleState attacker = state.getOrCreateVehicle(e.attackerEid(), e.timestamp().rawClockSec());
            attacker.setLastObservedAt(e.timestamp().rawClockSec());
            attacker.addDamageDealt(e.damage());
        }
        final VehicleState victim = state.getOrCreateVehicle(e.victimEid(), e.timestamp().rawClockSec());
        victim.setLastObservedAt(e.timestamp().rawClockSec());
        victim.addDamageReceived(e.damage());
    }

    private void applyEntityRemoved(final BattleState state, final EntityRemovedEvent e) {
        final VehicleState vs = state.getVehicle(e.entityId());
        if (vs != null) {
            vs.setRemovedAt(e.timestamp().rawClockSec());
            vs.setObservationState(ObservationState.REMOVED);
        }
    }

    private void applyVehicleDestroyed(final BattleState state, final VehicleDestroyedEvent e) {
        final VehicleState vs = state.getOrCreateVehicle(e.entityId(), e.timestamp().rawClockSec());
        if (vs.lifeState() == LifeState.DESTROYED && e.inferred()) {
            return;
        }
        vs.setLastObservedAt(e.timestamp().rawClockSec());
        markDestroyed(vs);
    }

    private void applyBattleEnded(final BattleState state, final BattleEndedEvent e) {
        state.setBattleEnded(true);
        state.setLifecycle(BattleLifecycle.FINISHED);
        if (e.winnerTeam() != null) {
            state.setWinnerTeam(e.winnerTeam());
        }
    }

    private void applyHealth(final BattleState state, final HealthChangedEvent e) {
        final VehicleState vs = state.getOrCreateVehicle(e.entityId(), e.timestamp().rawClockSec());
        vs.setLastObservedAt(e.timestamp().rawClockSec());
        if (e.currentHealth() != null) {
            if (!(DecodeConfidenceHelper.isLowConfidence(e.confidence())
                    && vs.lifeState() == LifeState.DESTROYED)) {
                vs.setCurrentHealth(e.currentHealth());
            }
        }
        if (e.maxHealth() != null) {
            vs.setMaxHealth(e.maxHealth());
        }
        if (e.confidence() == DecodeConfidence.EXACT && e.rawState() != null && e.rawState().terminal()) {
            markDestroyed(vs);
            return;
        }
        if (e.alive() != null) {
            if (!e.alive() && vs.lifeState() != LifeState.DESTROYED) {
                markDestroyed(vs);
            } else if (e.alive() && !(vs.lifeState() == LifeState.DESTROYED
                    && DecodeConfidenceHelper.isLowConfidence(e.confidence()))) {
                vs.setLifeState(LifeState.ALIVE);
            }
        }
    }

    private void applyEntityCreated(final BattleState state, final EntityCreatedEvent e) {
        state.getOrCreateVehicle(e.entityId(), e.timestamp().rawClockSec());
    }

    private void applyMaterialization(final BattleState state, final MaterializationEvent e) {
        final VehicleState vs = state.getOrCreateVehicle(e.entityId(), e.timestamp().rawClockSec());
        vs.setLastObservedAt(e.timestamp().rawClockSec());
        if (e.currentHp() != null && e.confidence() == DecodeConfidence.EXACT) {
            vs.setCurrentHealth(e.currentHp());
            vs.setLifeState(LifeState.ALIVE);
        }
        if (vs.observationState() == ObservationState.REMOVED
                || vs.observationState() == ObservationState.UNKNOWN) {
            vs.setObservationState(ObservationState.OBSERVED);
        }
    }

    private void applyRecorderHealth(final BattleState state, final RecorderHealthChangedEvent e) {
        final VehicleState vs = state.getOrCreateVehicle(e.entityId(), e.timestamp().rawClockSec());
        vs.setLastObservedAt(e.timestamp().rawClockSec());
        if (e.confidence() == DecodeConfidence.EXACT
                && e.currentHp() > 0 && e.currentHp() < 0xFF00) {
            vs.setCurrentHealth(e.currentHp());
            vs.setLifeState(LifeState.ALIVE);
        }
    }

    private void applyVehicleHealthState(final BattleState state, final VehicleHealthStateEvent e) {
        final VehicleState vs = state.getOrCreateVehicle(e.entityId(), e.timestamp().rawClockSec());
        vs.setLastObservedAt(e.timestamp().rawClockSec());
        if (e.confidence() != DecodeConfidence.EXACT) {
            return;
        }
        final HpRawState rawState = HpRawState.classify(e.currentHpRaw(), true);
        if (rawState == HpRawState.CURRENT_HP) {
            vs.setCurrentHealth((int) (short) (e.currentHpRaw() & 0xFFFF));
        } else if (rawState == HpRawState.HP_ZERO_TERMINAL) {
            vs.setCurrentHealth(0);
        }
        if (rawState.terminal() || e.cause() == VehicleHealthStateEvent.Cause.DROWNING) {
            markDestroyed(vs);
        }
    }

    private static void markDestroyed(final VehicleState vs) {
        vs.setLifeState(LifeState.DESTROYED);
        vs.setObservationState(ObservationState.REMOVED);
    }

    private void applyMapping(final BattleState state, final ParticipantMappingEvent e) {
        if (e.accountId() > 0) {
            state.registerMapping(e.entityId(), e.accountId());
        }
    }

    public static BattleStateSnapshot stateAt(
            final float targetClockSec,
            final List<ReplayEvent> events,
            final List<BattleStateCheckpoint> checkpoints,
            final boolean hasClockRegression) {
        if (!hasClockRegression && checkpoints != null && !checkpoints.isEmpty()) {
            return stateAtWithCheckpoints(targetClockSec, events, checkpoints);
        }
        return stateAtSafe(targetClockSec, events);
    }

    public static BattleStateSnapshot stateAt(
            final float targetClockSec,
            final List<ReplayEvent> events,
            final List<BattleStateCheckpoint> checkpoints) {
        return stateAt(targetClockSec, events, checkpoints, true);
    }

    private static BattleStateSnapshot stateAtWithCheckpoints(
            final float targetClockSec,
            final List<ReplayEvent> events,
            final List<BattleStateCheckpoint> checkpoints) {
        BattleStateCheckpoint nearest = checkpoints.getFirst();
        for (final BattleStateCheckpoint cp : checkpoints) {
            if (cp.rawClockSec() <= targetClockSec) nearest = cp;
            else break;
        }
        final BattleState state = snapshotToMutable(nearest.stateSnapshot());
        state.setRawClockSec(nearest.rawClockSec());
        final BattleStateReconstructor replayer = new BattleStateReconstructor();
        for (int i = nearest.eventIndex(); i < events.size(); i++) {
            final ReplayEvent event = events.get(i);
            if (event.timestamp().rawClockSec() > targetClockSec) break;
            replayer.applyEvent(state, event);
            state.setRawClockSec(event.timestamp().rawClockSec());
        }
        return BattleStateSnapshot.from(state);
    }

    private static BattleStateSnapshot stateAtSafe(
            final float targetClockSec, final List<ReplayEvent> events) {
        final BattleState state = new BattleState();
        final BattleStateReconstructor replayer = new BattleStateReconstructor();
        float maxClock = 0f;
        boolean any = false;
        for (final ReplayEvent event : events) {
            final float clock = event.timestamp().rawClockSec();
            if (clock > targetClockSec) continue;
            replayer.applyEvent(state, event);
            if (!any || clock > maxClock) {
                maxClock = clock;
                any = true;
            }
        }
        state.setRawClockSec(any ? maxClock : 0f);
        return BattleStateSnapshot.from(state);
    }

    private static BattleState snapshotToMutable(final BattleStateSnapshot snapshot) {
        final BattleState state = new BattleState();
        state.setRawClockSec(snapshot.rawClockSec());
        state.setBattleClockSec(snapshot.battleClockSec());
        state.setLifecycle(snapshot.lifecycle());
        state.setBattleEnded(snapshot.battleEnded());
        state.setWinnerTeam(snapshot.winnerTeam());
        for (final var entry : snapshot.vehiclesByEntityId().entrySet()) {
            state.getVehiclesByEntityId().put(entry.getKey(), entry.getValue().copy());
        }
        state.getEntityIdByAccountId().putAll(snapshot.entityIdByAccountId());
        state.getParticipants().addAll(snapshot.participants());
        return state;
    }
}
