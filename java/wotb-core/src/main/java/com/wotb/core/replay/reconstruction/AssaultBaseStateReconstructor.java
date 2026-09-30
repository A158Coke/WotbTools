package com.wotb.core.replay.reconstruction;

import com.wotb.core.replay.event.AssaultBaseStateTransition;
import com.wotb.core.replay.event.RawAssaultBaseUpdate;
import com.wotb.core.replay.event.RawSupremacyBaseUpdate;
import com.wotb.core.replay.event.ReplayEvent;

import java.util.Comparator;
import java.util.List;

/**
 * Reconstructs the proven realtime Assault progress family from wrapper8.
 *
 * <p>Current controlled evidence: wrapper8/root8 nested raw field1=2,
 * raw field2=1, field3=progress emits the single-base capture counter from
 * 1 through 100. The sibling raw field1=1/field4 family is preserved by the
 * decoder but is not assigned production semantics here.</p>
 */
public final class AssaultBaseStateReconstructor {

    private AssaultBaseStateReconstructor() {
    }

    public static List<AssaultBaseStateTransition> reconstruct(final List<ReplayEvent> events) {
        if (events == null || events.isEmpty()) {
            return List.of();
        }
        if (!hasObjective(events)) {
            return List.of();
        }
        return events.stream()
                .filter(RawAssaultBaseUpdate.class::isInstance)
                .map(RawAssaultBaseUpdate.class::cast)
                .filter(AssaultBaseStateReconstructor::isObjectiveFamily)
                .filter(update -> update.rawField3() != null
                        && update.rawField3() >= 0 && update.rawField3() <= 100)
                .sorted(Comparator.comparingDouble(AssaultBaseStateReconstructor::rawClock)
                        .thenComparingInt(RawAssaultBaseUpdate::sequence))
                .map(update -> new AssaultBaseStateTransition(
                        update.sequence(), update.timestamp(), update.packetType(),
                        update.confidence(),
                        update.rawField3()))
                .toList();
    }

    /** Proven wrapper8 objective family, independent of whether progress is present. */
    public static boolean hasObjective(final List<ReplayEvent> events) {
        if (events == null || events.stream().anyMatch(RawSupremacyBaseUpdate.class::isInstance)) {
            return false;
        }
        return events.stream()
                .filter(RawAssaultBaseUpdate.class::isInstance)
                .map(RawAssaultBaseUpdate.class::cast)
                .anyMatch(AssaultBaseStateReconstructor::isObjectiveFamily);
    }

    private static boolean isObjectiveFamily(final RawAssaultBaseUpdate update) {
        return Integer.valueOf(2).equals(update.rawField1())
                && Integer.valueOf(1).equals(update.rawField2())
                && update.confidence() == com.wotb.core.replay.event.DecodeConfidence.EXACT;
    }

    private static double rawClock(final RawAssaultBaseUpdate update) {
        return update.timestamp() == null
                ? Double.POSITIVE_INFINITY
                : update.timestamp().rawClockSec();
    }
}
