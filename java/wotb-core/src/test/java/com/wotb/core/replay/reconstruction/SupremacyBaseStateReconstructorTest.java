package com.wotb.core.replay.reconstruction;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.RawSupremacyBaseUpdate;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.SupremacyBaseId;
import com.wotb.core.replay.event.SupremacyBaseStateTransition;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class SupremacyBaseStateReconstructorTest {

    @Test
    void reconstructsNeutralCapturingCapturedLifecycle() {
        final List<SupremacyBaseStateTransition> states = reconstruct(
                raw(1, 0, 0, 0, 0, null, null),
                raw(2, 0, null, 1, 3, null, null),
                raw(3, 0, 1, null, null, null, null));

        assertState(states.get(0), SupremacyBaseId.A, null, null, null);
        assertState(states.get(1), SupremacyBaseId.A, null, 1, 3);
        assertState(states.get(2), SupremacyBaseId.A, 1, null, null);
    }

    @Test
    void explicitCapturingClearCancelsCaptureAndRetainsOwner() {
        final List<SupremacyBaseStateTransition> states = reconstruct(
                raw(1, 1, 2, 0, 0, null, null),
                raw(2, 1, null, 1, 40, null, null),
                raw(3, 1, null, 0, null, null, null));

        assertState(states.get(1), SupremacyBaseId.B, 2, 1, 40);
        assertState(states.get(2), SupremacyBaseId.B, 2, null, null);
    }

    @Test
    void ownerChangeCompletesCaptureAndClearsCaptureFields() {
        final List<SupremacyBaseStateTransition> states = reconstruct(
                raw(1, 1, 2, 0, 0, null, null),
                raw(2, 1, null, 1, 40, null, null),
                raw(3, 1, 1, null, null, null, null));

        assertState(states.get(2), SupremacyBaseId.B, 1, null, null);
    }

    @Test
    void reconstructsThreeAndFourBaseInitializations() {
        final List<SupremacyBaseStateTransition> three = reconstruct(
                raw(1, 0, 0, 0, 0, null, null),
                raw(2, 1, 0, 0, 0, null, null),
                raw(3, 2, 0, 0, 0, null, null));
        assertEquals(List.of(SupremacyBaseId.A, SupremacyBaseId.B, SupremacyBaseId.C),
                three.stream().map(SupremacyBaseStateTransition::baseId).toList());

        final List<SupremacyBaseStateTransition> four = reconstruct(
                raw(1, 0, 0, 0, 0, null, null),
                raw(2, 1, 0, 0, 0, null, null),
                raw(3, 2, 0, 0, 0, null, null),
                raw(4, 3, 0, 0, 0, null, null));
        assertEquals(List.of(SupremacyBaseId.A, SupremacyBaseId.B, SupremacyBaseId.C, SupremacyBaseId.D),
                four.stream().map(SupremacyBaseStateTransition::baseId).toList());
    }

    @Test
    void absentBaseIndexUsesProtocolDefaultAWithoutChangingPresenceFact() {
        final List<SupremacyBaseStateTransition> states = reconstruct(
                raw(1, null, null, null, null, null, null));
        assertEquals(SupremacyBaseId.A, states.getFirst().baseId());
    }

    @Test
    void sparseUpdateRetainsPreviousCanonicalState() {
        final List<SupremacyBaseStateTransition> states = reconstruct(
                raw(1, 2, 2, 1, 55, null, null),
                raw(2, 2, null, null, null, null, null));
        assertState(states.get(1), SupremacyBaseId.C, 2, 1, 55);
    }

    @Test
    void fieldFiveAndSixNeverBecomeCanonicalState() {
        final List<SupremacyBaseStateTransition> states = reconstruct(
                raw(1, 0, null, null, null, 1, 1));
        assertState(states.getFirst(), SupremacyBaseId.A, null, null, null);
    }

    @Test
    void nonRawEventsProduceNoCanonicalState() {
        assertEquals(List.of(), SupremacyBaseStateReconstructor.reconstruct(List.of()));
    }

    private static List<SupremacyBaseStateTransition> reconstruct(final RawSupremacyBaseUpdate... updates) {
        final List<ReplayEvent> events = new ArrayList<>(List.of(updates));
        return SupremacyBaseStateReconstructor.reconstruct(events);
    }

    private static RawSupremacyBaseUpdate raw(final int sequence, final Integer baseIndex,
            final Integer owner, final Integer capturing, final Integer progress,
            final Integer field5, final Integer field6) {
        return new RawSupremacyBaseUpdate(sequence, new ReplayTimestamp(sequence, null), 48,
                DecodeConfidence.EXACT, baseIndex, owner, capturing, progress, field5, field6);
    }

    private static void assertState(final SupremacyBaseStateTransition state, final SupremacyBaseId baseId,
            final Integer owner, final Integer capturing, final Integer progress) {
        assertEquals(baseId, state.baseId());
        assertEquals(owner, state.ownerTeam());
        assertEquals(capturing, state.capturingTeam());
        if (progress == null) {
            assertNull(state.captureProgress());
        } else {
            assertEquals(progress, state.captureProgress());
        }
    }
}
