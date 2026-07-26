package com.wotb.core.replay.feature;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class BattleStartResolverTest {

    @Test
    void negativeFirstClockUsesZero() {
        assertEquals(0f, BattleStartResolver.inferFromFirstClock(-5f), 0.01f);
    }

    @Test
    void positiveFirstClockUsesItself() {
        assertEquals(2.5f, BattleStartResolver.inferFromFirstClock(2.5f), 0.01f);
    }

    @Test
    void zeroFirstClockUsesZero() {
        assertEquals(0f, BattleStartResolver.inferFromFirstClock(0f), 0.01f);
    }

    @Test
    void nanFirstClockReturnsNull() {
        assertNull(BattleStartResolver.inferFromFirstClock(Float.NaN));
    }

    @Test
    void infFirstClockReturnsNull() {
        assertNull(BattleStartResolver.inferFromFirstClock(Float.POSITIVE_INFINITY));
    }

    @Test
    void battleRelativeWithStart() {
        assertEquals(5f, BattleStartResolver.battleRelative(10f, 5f), 0.01f);
        assertEquals(0f, BattleStartResolver.battleRelative(0f, 0f), 0.01f);
    }

    @Test
    void battleRelativeWithoutStartFallsBackToRaw() {
        assertEquals(10f, BattleStartResolver.battleRelative(10f, null), 0.01f);
    }

    @Test
    void isPreBattleWithNullStart() {
        assertFalse(BattleStartResolver.isPreBattle(5f, null));
    }

    @Test
    void isPreBattleWithStart() {
        assertTrue(BattleStartResolver.isPreBattle(-2f, 0f));
        assertFalse(BattleStartResolver.isPreBattle(3f, 0f));
        assertFalse(BattleStartResolver.isPreBattle(0f, 0f));
    }
}
