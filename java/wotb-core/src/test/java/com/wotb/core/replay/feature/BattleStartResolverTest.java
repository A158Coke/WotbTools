package com.wotb.core.replay.feature;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.feature.TacticalTimeResolution;
import org.junit.jupiter.api.Test;

class BattleStartResolverTest {

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
