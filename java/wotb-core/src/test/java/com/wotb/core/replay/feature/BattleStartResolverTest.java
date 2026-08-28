package com.wotb.core.replay.feature;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.RoundFinishedEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.feature.TacticalTimeResolution;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;

import java.util.List;

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

    @Test
    void reconstructionStartTakesPriority() {
        final BattleStartResolution r = BattleStartResolver.resolve(50f, null, List.of(), null);
        assertEquals(BattleStartResolution.Status.IDENTIFIED, r.status());
        assertEquals(50f, r.battleStartRawClockSec(), 0.01f);
    }

    @Test
    void diagnosticsIdentifiedTakesPriority() {
        final ReplayStreamDiagnostics diag = new ReplayStreamDiagnostics(
                0, 0, 0, 0, 0, 0f, 0f, 0, null, true, 75f, false
        );
        final BattleStartResolution r = BattleStartResolver.resolve(null, diag, List.of(), null);
        assertEquals(BattleStartResolution.Status.IDENTIFIED, r.status());
        assertEquals(75f, r.battleStartRawClockSec(), 0.01f);
    }

    @Test
    void diagnosticsUnresolvedContinuesToEndEvent() {
        final ReplayStreamDiagnostics diag = new ReplayStreamDiagnostics(
                0, 0, 0, 0, 0, 0f, 0f, 0, null, false, null, false
        );
        final Battle battle = new Battle();
        battle.durationS = 60.0;
        final List<ReplayEvent> events = List.of(
                RoundFinishedEvent.of(1, new ReplayTimestamp(120f, null), 14, DecodeConfidence.EXACT, 1)
        );
        final BattleStartResolution r = BattleStartResolver.resolve(null, diag, events, battle);
        assertEquals(BattleStartResolution.Status.ESTIMATED, r.status());
        assertEquals(60f, r.battleStartRawClockSec(), 0.01f);
    }

    @Test
    void noEvidenceReturnsUnresolved() {
        final BattleStartResolution r = BattleStartResolver.resolve(null, null, null, null);
        assertEquals(BattleStartResolution.Status.UNRESOLVED, r.status());
    }

    @Test
    void durationWithValidEndEvent() {
        final Battle battle = new Battle();
        battle.durationS = 60.0;
        final List<ReplayEvent> events = List.of(
                RoundFinishedEvent.of(1, new ReplayTimestamp(120f, null), 14, DecodeConfidence.EXACT, 1)
        );
        final BattleStartResolution r = BattleStartResolver.resolve(null, null, events, battle);
        assertEquals(BattleStartResolution.Status.ESTIMATED, r.status());
        assertEquals(60f, r.battleStartRawClockSec(), 0.01f);
        assertEquals("PRE_BATTLE_START_ESTIMATED", r.limitation());
    }

    @Test
    void negativeDerivedStartReturnsUnresolved() {
        final Battle battle = new Battle();
        battle.durationS = 60.0;
        final List<ReplayEvent> events = List.of(
                RoundFinishedEvent.of(1, new ReplayTimestamp(30f, null), 14, DecodeConfidence.EXACT, 1)
        );
        final BattleStartResolution r = BattleStartResolver.resolve(null, null, events, battle);
        assertEquals(BattleStartResolution.Status.UNRESOLVED, r.status());
    }

    @Test
    void nanDurationReturnsUnresolved() {
        final Battle battle = new Battle();
        battle.durationS = Double.NaN;
        final List<ReplayEvent> events = List.of(
                RoundFinishedEvent.of(1, new ReplayTimestamp(120f, null), 14, DecodeConfidence.EXACT, 1)
        );
        final BattleStartResolution r = BattleStartResolver.resolve(null, null, events, battle);
        assertEquals(BattleStartResolution.Status.UNRESOLVED, r.status());
    }

    @Test
    void invalidEndTimestampReturnsUnresolved() {
        final Battle battle = new Battle();
        battle.durationS = 60.0;
        final List<ReplayEvent> events = List.of(
                RoundFinishedEvent.of(1, new ReplayTimestamp(Float.NaN, null), 14, DecodeConfidence.EXACT, 1)
        );
        final BattleStartResolution r = BattleStartResolver.resolve(null, null, events, battle);
        assertEquals(BattleStartResolution.Status.UNRESOLVED, r.status());
    }

    @Test
    void multipleEndEventsFirstInvalidSecondValid() {
        final Battle battle = new Battle();
        battle.durationS = 60.0;
        final List<ReplayEvent> events = List.of(
                RoundFinishedEvent.of(1, new ReplayTimestamp(Float.NaN, null), 14, DecodeConfidence.EXACT, 1),
                RoundFinishedEvent.of(2, new ReplayTimestamp(120f, null), 14, DecodeConfidence.EXACT, 1)
        );
        final BattleStartResolution r = BattleStartResolver.resolve(null, null, events, battle);
        assertEquals(BattleStartResolution.Status.ESTIMATED, r.status());
        assertEquals(60f, r.battleStartRawClockSec(), 0.01f);
    }

    @Test
    void zeroDurationReturnsUnresolved() {
        final Battle battle = new Battle();
        battle.durationS = 0.0;
        final List<ReplayEvent> events = List.of(
                RoundFinishedEvent.of(1, new ReplayTimestamp(120f, null), 14, DecodeConfidence.EXACT, 1)
        );
        final BattleStartResolution r = BattleStartResolver.resolve(null, null, events, battle);
        assertEquals(BattleStartResolution.Status.UNRESOLVED, r.status());
    }
}
