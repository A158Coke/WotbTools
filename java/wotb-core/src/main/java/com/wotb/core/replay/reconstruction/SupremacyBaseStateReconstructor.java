package com.wotb.core.replay.reconstruction;

import com.wotb.core.replay.event.RawSupremacyBaseUpdate;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.SupremacyBaseId;
import com.wotb.core.replay.event.SupremacyBaseStateTransition;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/** Reconstructs sparse wrapper12 updates into full canonical base states. */
public final class SupremacyBaseStateReconstructor {

    private SupremacyBaseStateReconstructor() {
    }

    /**
     * Missing raw fields retain the prior state. Explicit zero on owner or
     * capturing clears that field; an explicit capturing clear also clears
     * progress. An owner change while capturing completes that capture and
     * clears the capture fields.
     */
    public static List<SupremacyBaseStateTransition> reconstruct(final List<ReplayEvent> events) {
        if (events == null || events.isEmpty()) {
            return List.of();
        }
        final List<RawSupremacyBaseUpdate> raw = events.stream()
                .filter(RawSupremacyBaseUpdate.class::isInstance)
                .map(RawSupremacyBaseUpdate.class::cast)
                .sorted(Comparator.comparingDouble(SupremacyBaseStateReconstructor::rawClock)
                        .thenComparingInt(RawSupremacyBaseUpdate::sequence))
                .toList();
        if (raw.isEmpty()) {
            return List.of();
        }

        final Map<SupremacyBaseId, MutableState> states = new EnumMap<>(SupremacyBaseId.class);
        final List<SupremacyBaseStateTransition> canonical = new ArrayList<>(raw.size());
        for (final RawSupremacyBaseUpdate update : raw) {
            // Raw keeps field1 absent as null. At the canonical protobuf boundary only,
            // absent field1 has its wire default index 0, which is the stable base A.
            final int protocolIndex = update.baseIndex() == null ? 0 : update.baseIndex();
            final SupremacyBaseId baseId = SupremacyBaseId.fromProtocolIndex(protocolIndex);
            final MutableState state = states.computeIfAbsent(baseId, ignored -> new MutableState());
            final Integer previousOwner = state.ownerTeam;
            final Integer previousCapturing = state.capturingTeam;

            if (update.ownerTeam() != null) {
                state.ownerTeam = nullableTeam(update.ownerTeam());
            }
            if (update.capturingTeam() != null) {
                state.capturingTeam = nullableTeam(update.capturingTeam());
            }
            if (update.captureProgress() != null) {
                state.captureProgress = update.captureProgress();
            }
            if (update.capturingTeam() != null && state.capturingTeam == null) {
                state.captureProgress = null;
            }

            if (update.ownerTeam() != null
                    && previousCapturing != null
                    && !java.util.Objects.equals(state.ownerTeam, previousOwner)) {
                state.capturingTeam = null;
                state.captureProgress = null;
            }

            canonical.add(new SupremacyBaseStateTransition(
                    update.sequence(), update.timestamp(), update.packetType(),
                    update.confidence(), baseId, state.ownerTeam,
                    state.capturingTeam, state.captureProgress));
        }
        return List.copyOf(canonical);
    }

    private static double rawClock(final RawSupremacyBaseUpdate update) {
        return update.timestamp() == null ? Double.POSITIVE_INFINITY : update.timestamp().rawClockSec();
    }

    private static Integer nullableTeam(final int team) {
        return team == 0 ? null : team;
    }

    private static final class MutableState {
        private Integer ownerTeam;
        private Integer capturingTeam;
        private Integer captureProgress;
    }
}
