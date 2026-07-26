package com.wotb.core.replay.feature;

import static org.junit.jupiter.api.Assertions.*;

import com.wotb.core.replay.event.DecodeConfidence;
import org.junit.jupiter.api.Test;

import java.util.List;

class TeamFormationClusterTest {

    @Test
    void validCluster() {
        final var c = new TeamFormationCluster(
                10f, 20f, 250f, 250f, 5,
                List.of("account:1001"), 1, DecodeConfidence.EXACT);
        assertEquals(10f, c.startTime());
        assertEquals(20f, c.endTime());
        assertEquals(250f, c.centroidX());
        assertEquals(5, c.region());
        assertEquals(1, c.memberCount());
    }

    @Test
    void nullConfidenceDefaultsToUnknown() {
        final var c = new TeamFormationCluster(
                10f, 20f, 250f, 250f, 5,
                List.of("account:1001"), 1, null);
        assertEquals(DecodeConfidence.UNKNOWN, c.confidence());
    }

    @Test
    void nullMemberIdentitiesBecomesEmpty() {
        final var c = new TeamFormationCluster(
                10f, 20f, 250f, 250f, 0,
                null, 0, DecodeConfidence.EXACT);
        assertTrue(c.memberIdentities().isEmpty());
    }

    @Test
    void defensiveCopy() {
        final var mutable = new java.util.ArrayList<>(List.of("a"));
        final var c = new TeamFormationCluster(
                10f, 20f, 250f, 250f, 5, mutable, 1, DecodeConfidence.EXACT);
        mutable.add("b"); // should NOT affect cluster
        assertEquals(1, c.memberIdentities().size());
    }

    @Test
    void invalidTimeRangeThrows() {
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationCluster(20f, 10f, 250f, 250f, 5, List.of(), 0, null));
    }

    @Test
    void nanTimeThrows() {
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationCluster(Float.NaN, 10f, 250f, 250f, 5, List.of(), 0, null));
    }

    @Test
    void nanCentroidThrows() {
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationCluster(10f, 20f, Float.NaN, 250f, 5, List.of(), 0, null));
    }

    @Test
    void invalidRegionThrows() {
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationCluster(10f, 20f, 250f, 250f, 10, List.of(), 0, null));
    }

    @Test
    void memberCountMismatchThrows() {
        assertThrows(IllegalArgumentException.class, () ->
                new TeamFormationCluster(10f, 20f, 250f, 250f, 5,
                        List.of("a", "b"), 3, DecodeConfidence.EXACT));
    }
}
