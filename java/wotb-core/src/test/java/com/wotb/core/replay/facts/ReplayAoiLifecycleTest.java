package com.wotb.core.replay.facts;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.EntityRemovedEvent;
import com.wotb.core.replay.event.MaterializationAnnouncedEvent;
import com.wotb.core.replay.event.MaterializationEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/** AoI 生命周期（B8/B9）：Type4 收段、Type33+Type5 重入开新段、段间 UNKNOWN_AOI。 */
class ReplayAoiLifecycleTest {

    private static ReplayTimestamp ts(final float raw) {
        return new ReplayTimestamp(raw, null);
    }

    private static PositionChangedEvent pos(final int seq, final float raw, final int entityId) {
        return new PositionChangedEvent(seq, ts(raw), 10, DecodeConfidence.EXACT,
                entityId, 0, 0, 0f, 0f, 0f,
                0f, 0f, 0f, 0f, 0f, 0f, 0);
    }

    @Test
    void leaveClosesSegmentAndReentryOpensNewSegment() {
        final List<ReplayEvent> events = new ArrayList<>();
        final int eid = 7;
        events.add(pos(1, 10f, eid));                                // observed from 10
        events.add(new EntityRemovedEvent(2, ts(20f), 4, DecodeConfidence.EXACT, eid)); // leave @20
        events.add(new MaterializationAnnouncedEvent(3, ts(30f), 33, DecodeConfidence.EXACT, eid, new byte[8]));
        events.add(new MaterializationEvent(4, ts(31f), 5, DecodeConfidence.EXACT,
                eid, 2, 2000, new byte[8], new byte[0]));             // re-entry @31
        events.add(pos(5, 40f, eid));                                // new position stream

        final List<AoiObservationSegment> segments = ReplayAoiLifecycle.build(events, 0.0);
        final List<AoiObservationSegment> mine = segments.stream()
                .filter(s -> s.entityId() == eid).toList();
        assertEquals(2, mine.size(), "leave 后 re-entry 必须产生两个观测段");
        assertEquals(10.0, mine.get(0).observedFromSec(), 1e-9);
        assertEquals(20.0, mine.get(0).absentFromSec(), 1e-9);
        assertEquals(31.0, mine.get(1).observedFromSec(), 1e-9);
        assertNull(mine.get(1).absentFromSec(), "re-entry 后未离开 → 段保持打开");
        // 段间 gap (20..31) 即 UNKNOWN_AOI：没有段覆盖该区间
        final boolean gapCovered = segments.stream().anyMatch(s ->
                s.entityId() == eid && s.observedFromSec() <= 25.0 && (s.absentFromSec() == null
                        || s.absentFromSec() >= 25.0));
        assertEquals(false, gapCovered, "leave→re-entry gap 内不得有任何观测段（UNKNOWN_AOI）");
    }

    @Test
    void type4AloneIsNotDeathButClosesObservation() {
        final List<ReplayEvent> events = new ArrayList<>();
        final int eid = 9;
        events.add(pos(1, 5f, eid));
        events.add(new EntityRemovedEvent(2, ts(15f), 4, DecodeConfidence.EXACT, eid));
        final List<AoiObservationSegment> segments = ReplayAoiLifecycle.build(events, 0.0);
        assertEquals(1, segments.size());
        assertEquals(15.0, segments.getFirst().absentFromSec(), 1e-9);
    }

    @Test
    void lowConfidencePositionDoesNotOpenSegment() {
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new PositionChangedEvent(1, ts(5f), 10, DecodeConfidence.PARTIAL,
                7, 0, 0, 0f, 0f, 0f,
                0f, 0f, 0f, 0f, 0f, 0f, 0));
        assertEquals(0, ReplayAoiLifecycle.build(events, 0.0).size());
    }

    @Test
    void materializationPresenceWithUnknownHpStillOpensSegment() {
        // §P0-1: presence proven (EXACT) + HP unknown (currentHp null) must still open the AoI
        // observed segment. Old bug tied presence confidence to HP decode, so an HP sentinel/unknown
        // collapsed the whole Type5 into PARTIAL and silently dropped this observed interval.
        final List<ReplayEvent> events = new ArrayList<>();
        final int eid = 11;
        events.add(pos(0, 10f, eid));                                // observed from 10 (opens segment 1)
        events.add(new EntityRemovedEvent(1, ts(20f), 4, DecodeConfidence.EXACT, eid)); // leave @20
        events.add(new MaterializationEvent(2, ts(31f), 5, DecodeConfidence.EXACT,
                eid, 2, null, new byte[8], new byte[0]));    // presence EXACT, HP UNKNOWN
        events.add(pos(3, 35f, eid));                        // position stream continues

        final List<AoiObservationSegment> segments = ReplayAoiLifecycle.build(events, 0.0);
        final List<AoiObservationSegment> mine = segments.stream()
                .filter(s -> s.entityId() == eid).toList();
        assertEquals(2, mine.size(), "leave@20 + re-materialize@31 must produce two segments");
        assertEquals(31.0, mine.get(1).observedFromSec(), 1e-9,
                "presence proven with unknown HP must open segment @31");
        assertNull(mine.get(1).absentFromSec(), "re-entry 后未离开 → 段保持打开");
    }
}
