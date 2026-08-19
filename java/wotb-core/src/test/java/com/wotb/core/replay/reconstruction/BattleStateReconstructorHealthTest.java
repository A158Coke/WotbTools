package com.wotb.core.replay.reconstruction;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

class BattleStateReconstructorHealthTest {

    private final BattleStateReconstructor reconstructor = new BattleStateReconstructor();

    private static ReplayTimestamp ts(final float sec) {
        return new ReplayTimestamp(sec, null);
    }

    private static HealthChangedEvent event(
            final int seq, final float sec, final int type,
            final DecodeConfidence confidence, final int eid,
            final Integer health, final Integer maxHealth,
            final Boolean alive) {
        return new HealthChangedEvent(seq, ts(sec), type, confidence, eid, health, maxHealth, alive);
    }

    /**
     * EXACT destroy with health=0, then attempt revive with given confidence/health.
     */
    private BattleState destroyThenRevive(
            final DecodeConfidence reviveConfidence,
            final Integer reviveHealth) {
        var destroy = event(1, 0f, 1, DecodeConfidence.EXACT, 101, 0, null, false);
        var revive = event(2, 1f, 2, reviveConfidence, 101, reviveHealth, null, true);
        return reconstructor.reconstruct(List.of(destroy, revive)).finalState();
    }

    @Test
    void exactDestroyThenPartialAliveStaysDestroyed() {
        var state = destroyThenRevive(DecodeConfidence.PARTIAL, 500);
        var v = state.getVehicle(101);
        assertEquals(LifeState.DESTROYED, v.lifeState());
        assertEquals(0, v.currentHealth().intValue(), "currentHealth must remain 0, not overwritten by PARTIAL");
    }

    @Test
    void exactDestroyThenUnknownAliveStaysDestroyed() {
        var state = destroyThenRevive(DecodeConfidence.UNKNOWN, 500);
        var v = state.getVehicle(101);
        assertEquals(LifeState.DESTROYED, v.lifeState());
        assertEquals(0, v.currentHealth().intValue(), "currentHealth must remain 0, not overwritten by UNKNOWN");
    }

    @Test
    void exactDestroyThenNullConfidenceAliveStaysDestroyed() {
        var state = destroyThenRevive(null, 500);
        var v = state.getVehicle(101);
        assertEquals(LifeState.DESTROYED, v.lifeState());
        assertEquals(0, v.currentHealth().intValue(), "currentHealth must remain 0, not overwritten by null confidence");
    }

    @Test
    void lowConfidenceHealthDoesNotWriteToDestroyedWithNullCurrent() {
        // Destroy without setting currentHealth (null), then partial writes health=500
        var destroy = event(1, 0f, 1, DecodeConfidence.EXACT, 101, null, null, false);
        var revive = event(2, 1f, 2, DecodeConfidence.PARTIAL, 101, 500, null, true);
        var state = reconstructor.reconstruct(List.of(destroy, revive)).finalState();
        var v = state.getVehicle(101);
        assertEquals(LifeState.DESTROYED, v.lifeState());
        assertNull(v.currentHealth(), "low-confidence health must not write to destroyed vehicle with null currentHealth");
    }

    @Test
    void exactDestroyThenExactAliveSameSequence() {
        var destroy = event(1, 0f, 1, DecodeConfidence.EXACT, 101, 0, null, false);
        var revive = event(2, 1f, 2, DecodeConfidence.EXACT, 101, 500, null, true);
        var state = reconstructor.reconstruct(List.of(destroy, revive)).finalState();
        var v = state.getVehicle(101);
        assertEquals(LifeState.ALIVE, v.lifeState());
        assertEquals(500, v.currentHealth().intValue());
    }

    @Test
    void lowConfidenceMaxHealthStillApplied() {
        // maxHealth is structural: should be written even by low-confidence events
        for (var conf : new DecodeConfidence[]{
                DecodeConfidence.PARTIAL, DecodeConfidence.UNKNOWN, null}) {
            var e = event(1, 0f, 1, conf, 101, null, 2000, null);
            var state = reconstructor.reconstruct(List.of(e)).finalState();
            var v = state.getVehicle(101);
            assertNotNull(v.maxHealth(), "maxHealth must be set by " + conf);
            assertEquals(2000, v.maxHealth().intValue());
        }
    }

    @Test
    void inferredMaxHealthApplied() {
        var e = event(1, 0f, 1, DecodeConfidence.INFERRED, 101, null, 2000, null);
        var state = reconstructor.reconstruct(List.of(e)).finalState();
        assertEquals(2000, state.getVehicle(101).maxHealth().intValue());
    }

    /**
     * 残血但存活（alive=true 且 HP>0 持续更新）不得被误判死亡。
     */
    @Test
    void lowHealthStaysAlive() {
        var e1 = event(1, 96.91f, 7, DecodeConfidence.EXACT, 101, 102, null, true);
        var e2 = event(2, 121.23f, 7, DecodeConfidence.EXACT, 101, 65, null, true);
        var state = reconstructor.reconstruct(List.of(e1, e2)).finalState();
        var v = state.getVehicle(101);
        assertEquals(LifeState.ALIVE, v.lifeState(), "残血 102/65 且 alive=true 不得判死");
        assertEquals(65, v.currentHealth().intValue());
    }

    /**
     * 跨实体状态隔离：A 的 UNKNOWN sentinel（alive=null）不得因 B 同刻阵亡而判死 A。
     */
    @Test
    void unknownSentinelOnOneEntityDoesNotAffectAnother() {
        var a = event(1, 100f, 7, DecodeConfidence.PARTIAL, 101, null, null, null);
        var b = event(2, 100f, 7, DecodeConfidence.EXACT, 202, 0, null, false);
        var state = reconstructor.reconstruct(List.of(a, b)).finalState();
        assertNotEquals(LifeState.DESTROYED, state.getVehicle(101).lifeState(),
                "unknown HP sentinel 不得判死实体 A");
        assertEquals(LifeState.DESTROYED, state.getVehicle(202).lifeState());
    }
}