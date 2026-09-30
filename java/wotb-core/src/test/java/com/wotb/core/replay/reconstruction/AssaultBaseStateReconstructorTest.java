package com.wotb.core.replay.reconstruction;

import com.wotb.core.replay.event.AssaultBaseStateTransition;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.RawAssaultBaseUpdate;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class AssaultBaseStateReconstructorTest {

    @Test
    void reconstructsInitializationAndFullCaptureIncludingOneHundred() {
        final List<ReplayEvent> events = List.of(
                raw(1, 2, 1, null, null),
                raw(2, 1, 1, null, 1),
                raw(3, 2, 1, 1, null),
                raw(4, 2, 1, 99, null),
                raw(5, 2, 1, 100, null));

        final List<AssaultBaseStateTransition> states =
                AssaultBaseStateReconstructor.reconstruct(events);

        assertEquals(List.of(0, 1, 99, 100),
                states.stream().map(AssaultBaseStateTransition::captureProgress).toList());
    }

    @Test
    void siblingRawFamilyDoesNotBecomeCanonicalTeamState() {
        final List<AssaultBaseStateTransition> states =
                AssaultBaseStateReconstructor.reconstruct(List.of(raw(1, 1, 1, null, 1)));
        assertEquals(List.of(), states);
    }

    private static RawAssaultBaseUpdate raw(final int sequence,
            final Integer field1, final Integer field2,
            final Integer progress, final Integer field4) {
        return new RawAssaultBaseUpdate(
                sequence, new ReplayTimestamp(sequence, null), 8, DecodeConfidence.EXACT,
                field1, field2, progress, field4);
    }
}
