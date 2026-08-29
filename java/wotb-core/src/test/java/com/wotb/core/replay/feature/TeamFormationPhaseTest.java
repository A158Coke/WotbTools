package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class TeamFormationPhaseTest {

    private static CanonicalMapPosition pos(final float x, final float z) {
        return new CanonicalMapPosition(x, z);
    }

    private static TeamFormationCluster cluster(final float sx, final float ex, final CanonicalMapPosition p,
                                                final int region, final List<String> ids, final DecodeConfidence conf) {
        return new TeamFormationCluster(sx, ex, p, MapCoordinateResolution.Status.VALID, region, 0, ids, conf);
    }

    @Test
    void validPhase() {
        final var p = pos(250f, 250f);
        final var c = cluster(10f, 90f, p, 5, List.of("account:1001"), DecodeConfidence.EXACT);
        final var phase = new TeamFormationPhase(0f, 100f, p, 15f, 8, DecodeConfidence.EXACT, List.of(c));
        assertEquals(0f, phase.startTime());
        assertEquals(100f, phase.endTime());
        assertEquals(p, phase.centroid());
        assertEquals(15f, phase.averageDispersion());
        assertEquals(8, phase.observedMemberCount());
        assertEquals(DecodeConfidence.EXACT, phase.confidence());
        assertEquals(1, phase.clusters().size());
        assertEquals(1, phase.clusterCount());
    }

    @Test
    void nullConfidenceDefaultsToUnknown() {
        final var p = pos(250f, 250f);
        final var c = cluster(10f, 90f, p, 5, List.of("account:1001"), DecodeConfidence.EXACT);
        final var phase = new TeamFormationPhase(0f, 100f, p, 15f, 8, null, List.of(c));
        assertEquals(DecodeConfidence.UNKNOWN, phase.confidence());
    }

    @Test
    void nullClustersBecomesEmptyList() {
        final var p = pos(250f, 250f);
        final var phase = new TeamFormationPhase(0f, 100f, p, 15f, 8, DecodeConfidence.EXACT, null);
        assertTrue(phase.clusters().isEmpty());
        assertEquals(0, phase.clusterCount());
    }

    @Test
    void defensiveCopyOfClusters() {
        final var p = pos(250f, 250f);
        final var mutable = new ArrayList<>(List.of(cluster(10f, 90f, p, 5, List.of("account:1001"), DecodeConfidence.EXACT)));
        final var phase = new TeamFormationPhase(0f, 100f, p, 15f, 8, DecodeConfidence.EXACT, mutable);
        mutable.clear();
        assertEquals(1, phase.clusters().size());
    }

    @Test
    void negativeStartTimeThrows() {
        final var p = pos(250f, 250f);
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationPhase(-1f, 100f, p, 15f, 8, DecodeConfidence.EXACT, null));
    }

    @Test
    void negativeEndTimeThrows() {
        final var p = pos(250f, 250f);
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationPhase(0f, -1f, p, 15f, 8, DecodeConfidence.EXACT, null));
    }

    @Test
    void nanStartTimeThrows() {
        final var p = pos(250f, 250f);
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationPhase(Float.NaN, 100f, p, 15f, 8, DecodeConfidence.EXACT, null));
    }

    @Test
    void infinityEndTimeThrows() {
        final var p = pos(250f, 250f);
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationPhase(0f, Float.POSITIVE_INFINITY, p, 15f, 8, DecodeConfidence.EXACT, null));
    }

    @Test
    void startTimeGreaterThanEndTimeThrows() {
        final var p = pos(250f, 250f);
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationPhase(100f, 0f, p, 15f, 8, DecodeConfidence.EXACT, null));
    }

    @Test
    void nullCentroidThrows() {
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationPhase(0f, 100f, null, 15f, 8, DecodeConfidence.EXACT, null));
    }

    @Test
    void negativeAverageDispersionThrows() {
        final var p = pos(250f, 250f);
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationPhase(0f, 100f, p, -1f, 8, DecodeConfidence.EXACT, null));
    }

    @Test
    void nanDispersionThrows() {
        final var p = pos(250f, 250f);
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationPhase(0f, 100f, p, Float.NaN, 8, DecodeConfidence.EXACT, null));
    }

    @Test
    void negativeObservedMemberCountThrows() {
        final var p = pos(250f, 250f);
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationPhase(0f, 100f, p, 15f, -1, DecodeConfidence.EXACT, null));
    }

    @Test
    void nullClusterInListThrows() {
        final var p = pos(250f, 250f);
        final var list = new ArrayList<TeamFormationCluster>();
        list.add(null);
        assertThrows(NullPointerException.class, () ->
                new TeamFormationPhase(0f, 100f, p, 15f, 8, DecodeConfidence.EXACT, list));
    }

    @Test
    void clusterStartTimeBeforePhaseStartTimeThrows() {
        final var p = pos(250f, 250f);
        final var c = cluster(5f, 90f, p, 5, List.of("account:1001"), DecodeConfidence.EXACT);
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationPhase(10f, 100f, p, 15f, 8, DecodeConfidence.EXACT, List.of(c)));
    }

    @Test
    void clusterEndTimeAfterPhaseEndTimeThrows() {
        final var p = pos(250f, 250f);
        final var c = cluster(10f, 110f, p, 5, List.of("account:1001"), DecodeConfidence.EXACT);
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationPhase(0f, 100f, p, 15f, 8, DecodeConfidence.EXACT, List.of(c)));
    }
}
