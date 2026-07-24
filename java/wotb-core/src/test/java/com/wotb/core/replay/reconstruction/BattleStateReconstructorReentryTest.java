package com.wotb.core.replay.reconstruction;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.EntityCreatedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class BattleStateReconstructorReentryTest {

    private static ReplayTimestamp ts(final float sec) {
        return new ReplayTimestamp(sec, null);
    }

    private static ReplayEvent eventAt(final float sec, final int eid) {
        return new EntityCreatedEvent((int) (sec * 1000), ts(sec), 1, DecodeConfidence.EXACT, eid, null);
    }

    private static void assertCheckpoint(
            final BattleStateCheckpoint cp,
            final int expectedEventIndex,
            final float expectedClock) {
        assertEquals(expectedEventIndex, cp.eventIndex());
        assertEquals(expectedClock, cp.rawClockSec(), 0.001f);
    }

    @Test
    void emptyEvents() {
        var rec = new BattleStateReconstructor();
        var result = rec.reconstruct(List.of());
        assertEquals(1, result.checkpoints().size());
        assertCheckpoint(result.checkpoints().get(0), 0, 0f);
    }

    @Test
    void timeIntervalTrigger() {
        // Checkpoint interval 2s, events at 0s, 2.5s, 5s
        // First event always triggers because lastCheckpointClock starts at -MAX
        var rec = new BattleStateReconstructor(null, 2f, 100);
        var result = rec.reconstruct(List.of(eventAt(0f, 101), eventAt(2.5f, 102), eventAt(5f, 103)));
        // cp0: initial; cp1: event1 triggers @0/1 (time from -MAX); cp2: event2 @2.5/2; cp3: event3 @5/3
        assertEquals(4, result.checkpoints().size());
        assertCheckpoint(result.checkpoints().get(0), 0, 0f);
        assertCheckpoint(result.checkpoints().get(1), 1, 0f);
        assertCheckpoint(result.checkpoints().get(2), 2, 2.5f);
        assertCheckpoint(result.checkpoints().get(3), 3, 5f);
    }

    @Test
    void eventCountIntervalTrigger() {
        // Event interval 2. The first event triggers a time-based checkpoint because
        // lastCheckpointClock starts at -Float.MAX_VALUE. Afterward the 100s time interval
        // does not trigger again, so subsequent checkpoints exercise the event-count
        // interval and the final checkpoint.
        var rec = new BattleStateReconstructor(null, 100f, 2);
        var result = rec.reconstruct(List.of(
                eventAt(1f, 101), eventAt(2f, 102), eventAt(3f, 103), eventAt(4f, 104)));
        // cp0: initial; cp1: event1 @1/1 (time from -MAX >= 100? 1 - (-MAX) >= 100 YES); cp2: event3 @3/3 (event-count=2); cp3: final @4/4
        assertEquals(4, result.checkpoints().size());
        assertCheckpoint(result.checkpoints().get(0), 0, 0f);
        assertCheckpoint(result.checkpoints().get(1), 1, 1f);
        assertCheckpoint(result.checkpoints().get(2), 3, 3f);
        assertCheckpoint(result.checkpoints().get(3), 4, 4f);
    }

    @Test
    void reentrySameCheckpointCountAndTimes() {
        var rec = new BattleStateReconstructor(null, 5f, 10);
        var events = List.of(eventAt(1f, 101), eventAt(3f, 102), eventAt(7f, 103));
        var result1 = rec.reconstruct(events);
        var result2 = rec.reconstruct(events);
        assertEquals(result1.checkpoints().size(), result2.checkpoints().size());
        for (int i = 0; i < result1.checkpoints().size(); i++) {
            assertEquals(result1.checkpoints().get(i).eventIndex(), result2.checkpoints().get(i).eventIndex());
            assertEquals(result1.checkpoints().get(i).rawClockSec(), result2.checkpoints().get(i).rawClockSec(), 0.001f);
        }
    }

    @Test
    void longThenShortList() {
        var rec = new BattleStateReconstructor();
        rec.reconstruct(List.of(eventAt(1f, 101), eventAt(2f, 102)));
        var shortResult = rec.reconstruct(List.of(eventAt(1f, 101)));
        assertEquals(2, shortResult.checkpoints().size());
        assertEquals(1, shortResult.checkpoints().getLast().eventIndex());
    }

    @Test
    void shortThenLongList() {
        var rec = new BattleStateReconstructor();
        rec.reconstruct(List.of(eventAt(1f, 101)));
        var longResult = rec.reconstruct(List.of(eventAt(1f, 101), eventAt(2f, 102)));
        assertEquals(3, longResult.checkpoints().size());
        assertEquals(2, longResult.checkpoints().getLast().eventIndex());
    }
}
