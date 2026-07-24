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
        return new EntityCreatedEvent((int)(sec*1000), ts(sec), 1, DecodeConfidence.EXACT, eid, null);
    }

    @Test
    void emptyEvents() {
        var rec = new BattleStateReconstructor();
        var result = rec.reconstruct(List.of());
        assertEquals(1, result.checkpoints().size());
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
    void singleEvent() {
        var rec = new BattleStateReconstructor();
        var result = rec.reconstruct(List.of(eventAt(1f, 101)));
        // Initial checkpoint + after processing one event
        assertEquals(2, result.checkpoints().size());
    }

    @Test
    void timeIntervalTrigger() {
        var rec = new BattleStateReconstructor(null, 2f, 100);
        var events = List.of(eventAt(0f, 101), eventAt(2.5f, 102), eventAt(5f, 103));
        var result = rec.reconstruct(events);
        // initial + 2 interval checkpoints + final = 4
        assertEquals(4, result.checkpoints().size());
    }

    @Test
    void eventCountIntervalTrigger() {
        var rec = new BattleStateReconstructor(null, 100f, 2);
        var events = List.of(eventAt(1f, 101), eventAt(2f, 102), eventAt(3f, 103), eventAt(4f, 104));
        var result = rec.reconstruct(events);
        // initial + 2 event-interval checkpoints + final = 4
        assertEquals(4, result.checkpoints().size());
    }

    @Test
    void longThenShortList() {
        var rec = new BattleStateReconstructor();
        var longList = List.of(eventAt(1f, 101), eventAt(2f, 102));
        var shortList = List.of(eventAt(1f, 101));
        var longResult = rec.reconstruct(longList);
        var shortResult = rec.reconstruct(shortList);
        // Short list should not be polluted by long list
        assertEquals(2, shortResult.checkpoints().size());
        assertEquals(1, shortResult.checkpoints().getLast().eventIndex());
    }

    @Test
    void shortThenLongList() {
        var rec = new BattleStateReconstructor();
        var shortList = List.of(eventAt(1f, 101));
        var longList = List.of(eventAt(1f, 101), eventAt(2f, 102));
        rec.reconstruct(shortList);
        var longResult = rec.reconstruct(longList);
        assertEquals(3, longResult.checkpoints().size());
        assertEquals(2, longResult.checkpoints().getLast().eventIndex());
    }
}
