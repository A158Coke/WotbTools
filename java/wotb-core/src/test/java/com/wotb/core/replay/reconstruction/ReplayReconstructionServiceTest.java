package com.wotb.core.replay.reconstruction;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

import com.wotb.core.replay.event.ArenaPeriodChangedEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;

import java.util.List;

import org.junit.jupiter.api.Test;

/**
 * PR147/PR162 battle-start anchor contract tests.
 *
 * <p>The single battle-start authority is
 * {@code ReplayReconstructionService.resolveBattleStartRawClock} (package-private); its
 * {@code ARENA_PERIOD.BATTLE} sub-step is covered here directly. {@code ReplayStreamDiagnostics}
 * carries no battle-start authority any more.</p>
 */
class ReplayReconstructionServiceTest {

    @Test
    void battleStartAnchorIsWrapper3BattleFirst() {
        final ReplayTimestamp pre = new ReplayTimestamp(100f, null);
        final ReplayTimestamp battleAnchor = new ReplayTimestamp(200f, null);
        final ReplayTimestamp after = new ReplayTimestamp(210f, null);
        final List<ReplayEvent> events = List.of(
                new ArenaPeriodChangedEvent(1, pre, 8, DecodeConfidence.EXACT, 2,
                        ArenaPeriodChangedEvent.Period.PREBATTLE),
                new ArenaPeriodChangedEvent(2, battleAnchor, 8, DecodeConfidence.EXACT, 3,
                        ArenaPeriodChangedEvent.Period.BATTLE),
                new ArenaPeriodChangedEvent(3, after, 8, DecodeConfidence.EXACT, 4,
                        ArenaPeriodChangedEvent.Period.AFTERBATTLE));
        assertEquals(200f, ReplayReconstructionService.battleStartRawClockFromArenaPeriod(events), 0.001f,
                "wrapper3 BATTLE (not PREBATTLE/AFTERBATTLE) is the battle-start anchor");
    }

    @Test
    void noBattleTransitionReturnsNull() {
        final ReplayTimestamp pre = new ReplayTimestamp(100f, null);
        assertNull(ReplayReconstructionService.battleStartRawClockFromArenaPeriod(
                List.of(new ArenaPeriodChangedEvent(1, pre, 8, DecodeConfidence.EXACT, 2,
                        ArenaPeriodChangedEvent.Period.PREBATTLE))),
                "no BATTLE period transition -> no anchor (null)");
    }
}
