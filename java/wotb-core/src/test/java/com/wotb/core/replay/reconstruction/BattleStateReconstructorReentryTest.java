package com.wotb.core.replay.reconstruction;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class BattleStateReconstructorReentryTest {

    @Test
    void emptyEvents() {
        var r = new BattleStateReconstructor();
        var result = r.reconstruct(List.of());
        assertEquals(1, result.checkpoints().size());
    }

    @Test
    void reentrySameCheckpointCount() {
        var r = new BattleStateReconstructor(null, 5f, 10);
        var ts1 = new com.wotb.core.replay.event.ReplayTimestamp(0f, null);
        var ts2 = new com.wotb.core.replay.event.ReplayTimestamp(1f, null);
        var ts3 = new com.wotb.core.replay.event.ReplayTimestamp(6f, null);
        var e1 = new com.wotb.core.replay.event.EntityCreatedEvent(1, ts1, 1, com.wotb.core.replay.event.DecodeConfidence.EXACT, 101, null);
        var e2 = new com.wotb.core.replay.event.EntityCreatedEvent(2, ts2, 1, com.wotb.core.replay.event.DecodeConfidence.EXACT, 102, null);
        var e3 = new com.wotb.core.replay.event.EntityCreatedEvent(3, ts3, 1, com.wotb.core.replay.event.DecodeConfidence.EXACT, 103, null);
        var events = List.<com.wotb.core.replay.event.ReplayEvent>of(e1, e2, e3);
        var result1 = r.reconstruct(events);
        var result2 = r.reconstruct(events);
        assertEquals(result1.checkpoints().size(), result2.checkpoints().size());
        for (int i = 0; i < result1.checkpoints().size(); i++) {
            assertEquals(result1.checkpoints().get(i).eventIndex(), result2.checkpoints().get(i).eventIndex());
        }
    }
}
