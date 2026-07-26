package com.wotb.core.replay.feature;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import com.wotb.core.replay.event.DecodeConfidence;
import org.junit.jupiter.api.Test;

import java.util.List;

class TeamFormationClusterTest {

    private static CanonicalMapPosition pos(final float x, final float z) {
        return new CanonicalMapPosition(x, z);
    }

    private static TeamFormationCluster cluster(final float sx, final float ex, final CanonicalMapPosition p,
                                                final int region, final List<String> ids, final DecodeConfidence conf) {
        return new TeamFormationCluster(sx, ex, p, MapCoordinateResolution.Status.VALID, region, ids, conf);
    }

    @Test
    void validCluster() {
        final var c = cluster(10f, 20f, pos(250f, 250f), 5,
                List.of("account:1001"), DecodeConfidence.EXACT);
        assertEquals(10f, c.startTime());
        assertEquals(20f, c.endTime());
        assertEquals(250f, c.centroidX());
        assertEquals(5, c.region());
        assertEquals(1, c.memberCount());
        assertEquals(MapCoordinateResolution.Status.VALID, c.centroidStatus());
    }

    @Test
    void nullConfidenceDefaultsToUnknown() {
        final var c = cluster(10f, 20f, pos(250f, 250f), 5,
                List.of("account:1001"), null);
        assertEquals(DecodeConfidence.UNKNOWN, c.confidence());
    }

    @Test
    void nullMemberIdentitiesThrows() {
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationCluster(10f, 20f, pos(250f, 250f),
                        MapCoordinateResolution.Status.VALID, 5, null, DecodeConfidence.EXACT));
    }

    @Test
    void defensiveCopy() {
        final var mutable = new java.util.ArrayList<>(List.of("a"));
        final var c = new TeamFormationCluster(10f, 20f, pos(250f, 250f),
                MapCoordinateResolution.Status.VALID, 5, mutable, DecodeConfidence.EXACT);
        mutable.add("b");
        assertEquals(1, c.memberIdentities().size());
    }

    @Test
    void invalidTimeRangeThrows() {
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationCluster(20f, 10f, pos(250f, 250f),
                        MapCoordinateResolution.Status.VALID, 5, List.of(), null));
    }

    @Test
    void nullCentroidThrows() {
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationCluster(10f, 20f, null, MapCoordinateResolution.Status.VALID, 5, List.of(), null));
    }

    @Test
    void centroidRegionMismatchThrows() {
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationCluster(10f, 20f, pos(250f, 250f),
                        MapCoordinateResolution.Status.VALID, 4, List.of(), null));
    }

    @Test
    void invalidRegionThrows() {
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationCluster(10f, 20f, pos(250f, 250f),
                        MapCoordinateResolution.Status.VALID, 10, List.of(), null));
    }

    @Test
    void invalidStatusThrows() {
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationCluster(10f, 20f, pos(250f, 250f),
                        MapCoordinateResolution.Status.INVALID, 5, List.of(), null));
    }

    @Test
    void blankIdentityThrows() {
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationCluster(10f, 20f, pos(250f, 250f),
                        MapCoordinateResolution.Status.VALID, 5,
                        List.of("a", ""), DecodeConfidence.EXACT));
    }

    @Test
    void duplicateIdentityThrows() {
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationCluster(10f, 20f, pos(250f, 250f),
                        MapCoordinateResolution.Status.VALID, 5,
                        List.of("a", "a"), DecodeConfidence.EXACT));
    }
}
