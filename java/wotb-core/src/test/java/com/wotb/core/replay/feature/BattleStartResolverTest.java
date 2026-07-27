package com.wotb.core.replay.feature;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.feature.TacticalTimeResolution;
import org.junit.jupiter.api.Test;

class BattleStartResolverTest {

    @Test
    void negativeFirstClockUsesZeroInferred() {
        final BattleStartResolution r = BattleStartResolver.inferFromFirstClock(-5f);
        assertEquals(BattleStartResolution.Status.ZERO_CLOCK_INFERRED, r.status());
        assertEquals(0f, r.battleStartRawClockSec(), 0.01f);
        assertTrue(r.resolved());
    }

    @Test
    void positiveFirstClockIsEstimated() {
        final BattleStartResolution r = BattleStartResolver.inferFromFirstClock(2.5f);
        assertEquals(BattleStartResolution.Status.ESTIMATED, r.status());
        assertEquals(2.5f, r.battleStartRawClockSec(), 0.01f);
    }

    @Test
    void zeroFirstClockUsesZeroEstimated() {
        final BattleStartResolution r = BattleStartResolver.inferFromFirstClock(0f);
        assertEquals(BattleStartResolution.Status.ESTIMATED, r.status());
        assertEquals(0f, r.battleStartRawClockSec(), 0.01f);
    }

    @Test
    void nanFirstClockReturnsUnresolved() {
        final BattleStartResolution r = BattleStartResolver.inferFromFirstClock(Float.NaN);
        assertEquals(BattleStartResolution.Status.UNRESOLVED, r.status());
        assertNull(r.battleStartRawClockSec());
        assertFalse(r.resolved());
    }

    @Test
    void infFirstClockReturnsUnresolved() {
        final BattleStartResolution r = BattleStartResolver.inferFromFirstClock(Float.POSITIVE_INFINITY);
        assertEquals(BattleStartResolution.Status.UNRESOLVED, r.status());
        assertNull(r.battleStartRawClockSec());
    }

    @Test
    void battleRelativeWithStart() {
        final BattleStartResolution r = new BattleStartResolution(BattleStartResolution.Status.IDENTIFIED, 5f, null);
        assertEquals(5f, r.battleRelative(10f), 0.01f);
        assertEquals(0f, r.battleRelative(5f), 0.01f);
    }

    @Test
    void battleRelativeWithoutStartReturnsNaN() {
        final BattleStartResolution r = BattleStartResolution.unresolved();
        assertTrue(Float.isNaN(r.battleRelative(10f)));
    }

    @Test
    void isPreBattleWithUnresolved() {
        assertFalse(BattleStartResolution.unresolved().isPreBattle(5f));
    }

    @Test
    void tryRelativeWithExistingBattleClock() {
        final BattleStartResolution r = new BattleStartResolution(BattleStartResolution.Status.IDENTIFIED, 60f, null);
        final ReplayTimestamp ts = new ReplayTimestamp(65f, 5f);
        final TacticalTimeResolution res = r.tryRelative(ts);
        assertTrue(res.isUsable());
        assertEquals(5f, res.battleRelativeSec(), 0.01f);
    }

    @Test
    void tryRelativeWithRawOnlyAndResolvedStart() {
        final BattleStartResolution r = new BattleStartResolution(BattleStartResolution.Status.IDENTIFIED, 60f, null);
        final ReplayTimestamp ts = new ReplayTimestamp(65f, null);
        final TacticalTimeResolution res = r.tryRelative(ts);
        assertTrue(res.isUsable());
        assertEquals(5f, res.battleRelativeSec(), 0.01f);
    }

    @Test
    void tryRelativeUnresolvedReturnsEmpty() {
        final BattleStartResolution r = BattleStartResolution.unresolved();
        final ReplayTimestamp ts = new ReplayTimestamp(120f, null);
        assertEquals(TacticalTimeResolution.Status.UNRESOLVED_RAW_ONLY, r.tryRelative(ts).status());
    }

    @Test
    void tryRelativeUnresolvedButHasBattleClock() {
        final BattleStartResolution r = BattleStartResolution.unresolved();
        final ReplayTimestamp ts = new ReplayTimestamp(120f, 20f);
        final TacticalTimeResolution res = r.tryRelative(ts);
        assertTrue(res.isUsable());
        assertEquals(20f, res.battleRelativeSec(), 0.01f);
    }

    @Test
    void tryRelativeNullTimestampReturnsEmpty() {
        assertEquals(TacticalTimeResolution.Status.INVALID_TIMESTAMP, BattleStartResolution.unresolved().tryRelative(null).status());
    }

    @Test
    void tryRelativeWithNegativeBattleClock() {
        final BattleStartResolution r = new BattleStartResolution(BattleStartResolution.Status.IDENTIFIED, 60f, null);
        final ReplayTimestamp ts = new ReplayTimestamp(65f, -5f);
        assertEquals(TacticalTimeResolution.Status.INVALID_TIMESTAMP, r.tryRelative(ts).status());
    }

    @Test
    void tryRelativeWithNaN() {
        final BattleStartResolution r = new BattleStartResolution(BattleStartResolution.Status.IDENTIFIED, 60f, null);
        final ReplayTimestamp ts = new ReplayTimestamp(Float.NaN, null);
        assertEquals(TacticalTimeResolution.Status.INVALID_TIMESTAMP, r.tryRelative(ts).status());
    }

    @Test
    void tryRelativeWithInfinity() {
        final BattleStartResolution r = new BattleStartResolution(BattleStartResolution.Status.IDENTIFIED, 60f, null);
        final ReplayTimestamp ts = new ReplayTimestamp(Float.POSITIVE_INFINITY, null);
        assertEquals(TacticalTimeResolution.Status.INVALID_TIMESTAMP, r.tryRelative(ts).status());
    }
}
