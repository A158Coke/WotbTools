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
        // Mode fail-closed: a replay with the independently proven wrapper12 Supremacy
        // base family must never also be projected as the single BASE objective even if
        // some unrelated wrapper8 payload happens to share this raw shape.
        if (events.stream().anyMatch(RawSupremacyBaseUpdate.class::isInstance)) {
            return List.of();
        }
        return events.stream()
                .filter(RawAssaultBaseUpdate.class::isInstance)
                .map(RawAssaultBaseUpdate.class::cast)
                .filter(update -> Integer.valueOf(2).equals(update.rawField1()))
                .filter(update -> Integer.valueOf(1).equals(update.rawField2()))
                .filter(update -> update.captureProgress() != null
                        && update.captureProgress() >= 0 && update.captureProgress() <= 100)
                .sorted(Comparator.comparingDouble(AssaultBaseStateReconstructor::rawClock)
                        .thenComparingInt(RawAssaultBaseUpdate::sequence))
                .map(update -> new AssaultBaseStateTransition(
                        update.sequence(), update.timestamp(), update.packetType(),
                        update.confidence(),
                        update.captureProgress()))
                .toList();
    }

    private static double rawClock(final RawAssaultBaseUpdate update) {
        return update.timestamp() == null
                ? Double.POSITIVE_INFINITY
                : update.timestamp().rawClockSec();
    }
}
