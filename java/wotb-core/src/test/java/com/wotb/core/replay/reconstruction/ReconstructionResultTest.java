package com.wotb.core.replay.reconstruction;

import com.wotb.core.replay.event.ReplayEvent;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ReconstructionResultTest {

    @Test
    void nullFinalStateFails() {
        assertThrows(NullPointerException.class,
                () -> new ReconstructionResult(null, snap(), List.of(), List.of()));
    }

    @Test
    void nullFinalSnapshotFails() {
        assertThrows(NullPointerException.class,
                () -> new ReconstructionResult(state(), null, List.of(), List.of()));
    }

    @Test
    void nullProcessedEventsFails() {
        assertThrows(NullPointerException.class,
                () -> new ReconstructionResult(state(), snap(), null, List.of()));
    }

    @Test
    void nullCheckpointsFails() {
        assertThrows(NullPointerException.class,
                () -> new ReconstructionResult(state(), snap(), List.of(), null));
    }

    @Test
    void listCopyProtectsFromMutation() {
        var events = new ArrayList<ReplayEvent>();
        var checkpoints = new ArrayList<BattleStateCheckpoint>();
        var r = new ReconstructionResult(state(), snap(), events, checkpoints);
        events.add(null);
        checkpoints.add(null);
        assertEquals(0, r.processedEvents().size());
        assertEquals(0, r.checkpoints().size());
    }

    @Test
    void returnedListsAreImmutable() {
        var r = new ReconstructionResult(state(), snap(), List.of(), List.of());
        assertThrows(UnsupportedOperationException.class,
                () -> r.processedEvents().add(null));
        assertThrows(UnsupportedOperationException.class,
                () -> r.checkpoints().add(null));
    }

    private static BattleState state() {
        return new BattleState();
    }

    private static BattleStateSnapshot snap() {
        return BattleStateSnapshot.from(new BattleState());
    }
}
