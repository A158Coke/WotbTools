package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BattleEndResolverTest {

    @Test
    void positiveFiniteDurationReturnsBATTLE_RESULTS() {
        final Battle battle = new Battle();
        battle.durationS = 120.0;

        final BattleEndResolver.BattleEndResult result = BattleEndResolver.resolve(battle, null, null);

        assertEquals(120f, result.battleEndRelativeSec());
        assertEquals(BattleEndResolver.BattleEndSource.BATTLE_RESULTS, result.source());
        assertNull(result.limitation());
        assertTrue(result.resolved());
    }

    @Test
    void nullDurationFallsBack() {
        final Battle battle = new Battle();
        battle.durationS = null;

        final BattleEndResolver.BattleEndResult result = BattleEndResolver.resolve(battle, null, null);

        assertNull(result.battleEndRelativeSec());
        assertEquals(BattleEndResolver.BattleEndSource.UNKNOWN, result.source());
    }

    @Test
    void nanDurationFallsBack() {
        final Battle battle = new Battle();
        battle.durationS = Double.NaN;

        final BattleEndResolver.BattleEndResult result = BattleEndResolver.resolve(battle, null, null);

        assertEquals(BattleEndResolver.BattleEndSource.UNKNOWN, result.source());
        assertNull(result.battleEndRelativeSec());
    }

    @Test
    void infiniteDurationFallsBack() {
        final Battle battle = new Battle();
        battle.durationS = Double.POSITIVE_INFINITY;

        final BattleEndResolver.BattleEndResult result = BattleEndResolver.resolve(battle, null, null);

        assertEquals(BattleEndResolver.BattleEndSource.UNKNOWN, result.source());
    }

    @Test
    void zeroDurationFallsBack() {
        final Battle battle = new Battle();
        battle.durationS = 0.0;

        final BattleEndResolver.BattleEndResult result = BattleEndResolver.resolve(battle, null, null);

        assertEquals(BattleEndResolver.BattleEndSource.UNKNOWN, result.source());
    }

    @Test
    void negativeDurationFallsBack() {
        final Battle battle = new Battle();
        battle.durationS = -10.0;

        final BattleEndResolver.BattleEndResult result = BattleEndResolver.resolve(battle, null, null);

        assertEquals(BattleEndResolver.BattleEndSource.UNKNOWN, result.source());
    }

    @Test
    void durationPrioritizedOverEvent() {
        final Battle battle = new Battle();
        battle.durationS = 120.0;

        final BattleEndResolver.BattleEndResult result = BattleEndResolver.resolve(battle, 90f, null);

        assertEquals(120f, result.battleEndRelativeSec());
        assertEquals(BattleEndResolver.BattleEndSource.BATTLE_RESULTS, result.source());
    }

    @Test
    void eventFallbackWhenDurationNull() {
        final Battle battle = new Battle();
        battle.durationS = null;

        final BattleEndResolver.BattleEndResult result = BattleEndResolver.resolve(battle, 90f, null);

        assertEquals(90f, result.battleEndRelativeSec());
        assertEquals(BattleEndResolver.BattleEndSource.REPLAY_EVENT, result.source());
    }

    @Test
    void eventZeroIsValidFallback() {
        final Battle battle = new Battle();
        battle.durationS = null;

        final BattleEndResolver.BattleEndResult result = BattleEndResolver.resolve(battle, 0f, null);

        assertEquals(0f, result.battleEndRelativeSec());
        assertEquals(BattleEndResolver.BattleEndSource.REPLAY_EVENT, result.source());
    }

    @Test
    void eventNegativeIsRejected() {
        final Battle battle = new Battle();
        battle.durationS = null;

        final BattleEndResolver.BattleEndResult result = BattleEndResolver.resolve(battle, -1f, null);

        assertNull(result.battleEndRelativeSec());
        assertEquals(BattleEndResolver.BattleEndSource.UNKNOWN, result.source());
    }

    @Test
    void scopeLocalFallbackWhenDurationAndEventNull() {
        final Battle battle = new Battle();
        battle.durationS = null;

        final BattleEndResolver.BattleEndResult result = BattleEndResolver.resolve(battle, null, 45f);

        assertEquals(45f, result.battleEndRelativeSec());
        assertEquals(BattleEndResolver.BattleEndSource.SCOPE_LOCAL_EVIDENCE, result.source());
    }

    @Test
    void scopeLocalNegativeIsRejected() {
        final Battle battle = new Battle();
        battle.durationS = null;

        final BattleEndResolver.BattleEndResult result = BattleEndResolver.resolve(battle, null, -5f);

        assertNull(result.battleEndRelativeSec());
        assertEquals(BattleEndResolver.BattleEndSource.UNKNOWN, result.source());
    }

    @Test
    void scopeLocalNaNIsRejected() {
        final Battle battle = new Battle();
        battle.durationS = null;

        final BattleEndResolver.BattleEndResult result = BattleEndResolver.resolve(battle, null, Float.NaN);

        assertEquals(BattleEndResolver.BattleEndSource.UNKNOWN, result.source());
    }

    @Test
    void unknownWhenAllNull() {
        final BattleEndResolver.BattleEndResult result = BattleEndResolver.resolve(null, null, null);

        assertNull(result.battleEndRelativeSec());
        assertEquals(BattleEndResolver.BattleEndSource.UNKNOWN, result.source());
        assertEquals("BATTLE_END_UNRESOLVED", result.limitation());
        assertFalse(result.resolved());
    }

    @Test
    void sourceEnumCorrectness() {
        assertEquals("BATTLE_RESULTS", BattleEndResolver.BattleEndSource.BATTLE_RESULTS.name());
        assertEquals("REPLAY_EVENT", BattleEndResolver.BattleEndSource.REPLAY_EVENT.name());
        assertEquals("SCOPE_LOCAL_EVIDENCE", BattleEndResolver.BattleEndSource.SCOPE_LOCAL_EVIDENCE.name());
        assertEquals("UNKNOWN", BattleEndResolver.BattleEndSource.UNKNOWN.name());
    }

    @Test
    void eventFiniteCheckRejectsInfinity() {
        final Battle battle = new Battle();
        battle.durationS = null;

        final BattleEndResolver.BattleEndResult result = BattleEndResolver.resolve(battle, Float.POSITIVE_INFINITY, null);

        assertEquals(BattleEndResolver.BattleEndSource.UNKNOWN, result.source());
    }

    @Test
    void scopeLocalFiniteCheckRejectsInfinity() {
        final Battle battle = new Battle();
        battle.durationS = null;

        final BattleEndResolver.BattleEndResult result = BattleEndResolver.resolve(battle, null, Float.POSITIVE_INFINITY);

        assertEquals(BattleEndResolver.BattleEndSource.UNKNOWN, result.source());
    }
}
