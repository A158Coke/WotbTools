package com.wotb.core.replay.reconstruction;

import com.wotb.core.replay.event.AssaultBaseStateTransition;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.RawAssaultBaseUpdate;
import com.wotb.core.replay.event.RawSupremacyBaseUpdate;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class AssaultBaseStateReconstructorTest {

    @Test
    void initializationProvesObjectiveWithoutInventingProgress() {
        final List<ReplayEvent> events = List.of(raw(1, 2, 1, null, null), raw(2, 1, 1, null, null));
        assertEquals(true, AssaultBaseStateReconstructor.hasObjective(events));
        assertEquals(List.of(), AssaultBaseStateReconstructor.reconstruct(events));
        assertEquals(false, AssaultBaseStateReconstructor.hasObjective(List.of(raw(1, 1, 1, null, null))));
        assertEquals(false, AssaultBaseStateReconstructor.hasObjective(List.of(raw(1, 2, 2, null, null))));
    }

    @Test
    void reconstructsInitializationAndFullCaptureIncludingOneHundred() {
        final List<ReplayEvent> events = List.of(
                raw(1, 2, 1, 0, null),
                raw(2, 1, 1, null, 1),
                raw(3, 2, 1, 1, null),
                raw(4, 2, 1, 99, null),
                raw(5, 2, 1, 100, null),
                raw(6, 2, 1, 50, null));

        final List<AssaultBaseStateTransition> states =
                AssaultBaseStateReconstructor.reconstruct(events);

        assertEquals(List.of(0, 1, 99, 100, 50),
                states.stream().map(AssaultBaseStateTransition::captureProgress).toList());
    }

    @Test
    void missingAndInvalidProgressNeverCreateCanonicalStates() {
        assertEquals(List.of(), AssaultBaseStateReconstructor.reconstruct(List.of(
                raw(1, 2, 1, null, null), raw(2, 2, 1, -1, null),
                raw(3, 2, 1, 101, null), raw(4, 2, 2, 50, null),
                raw(5, 1, 1, 300, null), raw(6, 3, 1, 50, null))));
    }

    @Test
    void siblingRawFamilyDoesNotBecomeCanonicalTeamState() {
        final List<AssaultBaseStateTransition> states =
                AssaultBaseStateReconstructor.reconstruct(List.of(raw(1, 1, 1, null, 1)));
        assertEquals(List.of(), states);
    }

    @Test
    void suppressesSingleBaseProjectionWhenSupremacyWrapper12IsPresent() {
        final RawSupremacyBaseUpdate supremacy = new RawSupremacyBaseUpdate(
                2, new ReplayTimestamp(2, null), 8, DecodeConfidence.EXACT,
                0, 0, 0, 0, null, null);
        final List<AssaultBaseStateTransition> states =
                AssaultBaseStateReconstructor.reconstruct(List.of(
                        raw(1, 2, 1, 40, null), supremacy));
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
