package com.wotb.core.replay.reconstruction;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class BattleStateReconstructorHealthTest {

    private final BattleStateReconstructor r = new BattleStateReconstructor();

    /** Helper: DESTROY vehicle first via EXACT confidence, then apply low-confidence alive=true */
    private BattleState sequence(final DecodeConfidence destroyConfidence,
                                  final DecodeConfidence reviveConfidence,
                                  final Integer reviveHealth) {
        // Destroy by EXACT confidence
        var destroy = new HealthChangedEvent(1, ts(0f), 1, destroyConfidence, 101, null, null, false);
        // Revive attempt
        var ts2 = ts(1f);
        var revive = new HealthChangedEvent(2, ts2, 2, reviveConfidence, 101, reviveHealth, null, true);
        var result = r.reconstruct(List.of(destroy, revive));
        return result.finalState();
    }

    private static ReplayTimestamp ts(final float sec) {
        return new ReplayTimestamp(sec, null);
    }

    @Test
    void exactDestroyThenPartialAliveStaysDestroyed() {
        var state = sequence(DecodeConfidence.EXACT, DecodeConfidence.PARTIAL, null);
        assertEquals(LifeState.DESTROYED, state.getVehicle(101).lifeState());
    }

    @Test
    void exactDestroyThenUnknownAliveStaysDestroyed() {
        var state = sequence(DecodeConfidence.EXACT, DecodeConfidence.UNKNOWN, null);
        assertEquals(LifeState.DESTROYED, state.getVehicle(101).lifeState());
    }

    @Test
    void exactDestroyThenNullConfidenceAliveStaysDestroyed() {
        var state = sequence(DecodeConfidence.EXACT, null, null);
        assertEquals(LifeState.DESTROYED, state.getVehicle(101).lifeState());
    }

    @Test
    void exactDestroyThenPartialHealthDoesNotOverride() {
        var state = sequence(DecodeConfidence.EXACT, DecodeConfidence.PARTIAL, 500);
        var vehicle = state.getVehicle(101);
        assertEquals(LifeState.DESTROYED, vehicle.lifeState());
    }

    @Test
    void exactDestroyThenExactAliveRevives() {
        var destroyed = r.reconstruct(List.of(
                new HealthChangedEvent(1, ts(0f), 1, DecodeConfidence.EXACT, 101, null, null, false)));
        var revived = r.reconstruct(List.of(
                new HealthChangedEvent(2, ts(1f), 1, DecodeConfidence.EXACT, 101, 500, null, true)));
        assertEquals(LifeState.ALIVE, revived.finalState().getVehicle(101).lifeState());
    }

    @Test
    void lowConfidenceMaxHealthStillApplied() {
        // maxHealth is a structural property; always set regardless of confidence
        var e1 = new HealthChangedEvent(1, ts(0f), 1, DecodeConfidence.EXACT, 101, null, 2000, false);
        var result = r.reconstruct(List.of(e1));
        assertEquals(2000, result.finalState().getVehicle(101).maxHealth().intValue());
    }

    @Test
    void inferredMaxHealthApplied() {
        var e1 = new HealthChangedEvent(1, ts(0f), 1, DecodeConfidence.INFERRED, 101, null, 2000, false);
        var result = r.reconstruct(List.of(e1));
        assertEquals(2000, result.finalState().getVehicle(101).maxHealth().intValue());
    }
}
