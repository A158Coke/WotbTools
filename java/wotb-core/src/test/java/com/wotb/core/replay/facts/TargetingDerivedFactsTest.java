package com.wotb.core.replay.facts;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.TargetingInfoSnapshotEvent;
import com.wotb.core.replay.reconstruction.Vector3;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** TargetingDerivedFacts（C7）：PRE/POST 配对 + bloom 增量。 */
class TargetingDerivedFactsTest {

    private static TargetingInfoSnapshotEvent snap(final int seq, final float clock,
                                                   final Double bloom) {
        return new TargetingInfoSnapshotEvent(seq, new ReplayTimestamp(clock, null), 8,
                DecodeConfidence.EXACT, 0.1, -0.05, 0.879, 0.499, 2.158, bloom, new byte[0]);
    }

    @Test
    void pairsPreAndPostAroundRecorderShot() {
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(snap(1, 5f, 1.0));
        events.add(snap(2, 9f, 1.5));
        final List<ShotFact> shots = List.of(new ShotFact(
                9001, 10, 1001L, 7.0,
                new Vector3(0f, 0f, 0f), new Vector3(1f, 0f, 0f),
                null, null, null, null, null, true));
        final List<TargetingShotPair> pairs = TargetingDerivedFacts.pair(shots, events, 0.0);
        assertEquals(1, pairs.size());
        final TargetingShotPair pair = pairs.getFirst();
        assertEquals(1.0, pair.dispersionBloomBefore(), 1e-9);
        assertEquals(1.5, pair.dispersionBloomAfter(), 1e-9);
        assertEquals(0.5, pair.bloomIncreaseAfterShot(), 1e-9);
        assertEquals(0.1, pair.turretYawBeforeShotRad(), 1e-9);
        assertEquals(-0.05, pair.gunPitchBeforeShotRad(), 1e-9);
    }

    @Test
    void nonRecorderShotsAreNotPaired() {
        final List<ShotFact> shots = List.of(new ShotFact(
                9002, 20, 0L, 7.0,
                new Vector3(0f, 0f, 0f), new Vector3(1f, 0f, 0f),
                null, null, null, null, null, false));
        assertTrue(TargetingDerivedFacts.pair(shots, List.of(snap(1, 5f, 1.0)), 0.0).isEmpty());
    }
}
