package com.wotb.core.replay.feature;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class TeamMapRegionResolverTest {

    // Region layout:
    // 1 | 2 | 3
    // 4 | 5 | 6
    // 7 | 8 | 9

    @Test
    void region1_topLeft() {
        assertEquals(1, TeamMapRegionResolver.resolveRegion(50, 450));
    }

    @Test
    void region2_topCenter() {
        assertEquals(2, TeamMapRegionResolver.resolveRegion(200, 450));
    }

    @Test
    void region3_topRight() {
        assertEquals(3, TeamMapRegionResolver.resolveRegion(450, 450));
    }

    @Test
    void region4_midLeft() {
        assertEquals(4, TeamMapRegionResolver.resolveRegion(50, 200));
    }

    @Test
    void region5_center() {
        assertEquals(5, TeamMapRegionResolver.resolveRegion(250, 250));
    }

    @Test
    void region6_midRight() {
        assertEquals(6, TeamMapRegionResolver.resolveRegion(450, 200));
    }

    @Test
    void region7_bottomLeft() {
        assertEquals(7, TeamMapRegionResolver.resolveRegion(50, 50));
    }

    @Test
    void region8_bottomCenter() {
        assertEquals(8, TeamMapRegionResolver.resolveRegion(200, 50));
    }

    @Test
    void region9_bottomRight() {
        assertEquals(9, TeamMapRegionResolver.resolveRegion(450, 50));
    }

    @Test
    void mapCorners() {
        assertEquals(1, TeamMapRegionResolver.resolveRegion(0, 500));
        assertEquals(3, TeamMapRegionResolver.resolveRegion(500, 500));
        assertEquals(7, TeamMapRegionResolver.resolveRegion(0, 0));
        assertEquals(9, TeamMapRegionResolver.resolveRegion(500, 0));
    }

    @Test
    void centerPoint() {
        assertEquals(5, TeamMapRegionResolver.resolveRegion(250, 250));
    }

    @Test
    void xBoundaryAtThird() {
        // X = 166.67 is the boundary between columns 1/4/7 and 2/5/8
        assertEquals(7, TeamMapRegionResolver.resolveRegion(166.66f, 50));
        assertEquals(8, TeamMapRegionResolver.resolveRegion(166.67f, 50));
    }

    @Test
    void zBoundaryAtThird() {
        // Z = 166.67 is the boundary between middle (4/5/6) and bottom (7/8/9) rows
        assertEquals(4, TeamMapRegionResolver.resolveRegion(50, 166.67f));
        assertEquals(7, TeamMapRegionResolver.resolveRegion(50, 166.66f));
    }

    @Test
    void outOfMapBoundsReturnsZero() {
        assertEquals(0, TeamMapRegionResolver.resolveRegion(-1, 250));
        assertEquals(0, TeamMapRegionResolver.resolveRegion(600, 250));
        assertEquals(0, TeamMapRegionResolver.resolveRegion(250, -1));
        assertEquals(0, TeamMapRegionResolver.resolveRegion(250, 600));
    }

    @Test
    void nanReturnsZero() {
        assertEquals(0, TeamMapRegionResolver.resolveRegion(Float.NaN, 250));
        assertEquals(0, TeamMapRegionResolver.resolveRegion(250, Float.NaN));
    }

    @Test
    void infinityReturnsZero() {
        assertEquals(0, TeamMapRegionResolver.resolveRegion(Float.POSITIVE_INFINITY, 250));
        assertEquals(0, TeamMapRegionResolver.resolveRegion(250, Float.NEGATIVE_INFINITY));
    }

    @Test
    void sameXZdifferentY_sameRegion() {
        assertEquals(5, TeamMapRegionResolver.resolveRegion(250, 250));
    }

    @Test
    void canonicalConversion() {
        // -5000 → 0, 0 → 250, 5000 → 500
        final float[] c1 = TeamMapRegionResolver.toCanonical(-5000, -5000);
        assertEquals(0f, c1[0], 0.01);
        assertEquals(0f, c1[1], 0.01);
        final float[] c2 = TeamMapRegionResolver.toCanonical(0, 0);
        assertEquals(250f, c2[0], 0.01);
        assertEquals(250f, c2[1], 0.01);
        final float[] c3 = TeamMapRegionResolver.toCanonical(5000, 5000);
        assertEquals(500f, c3[0], 0.01);
        assertEquals(500f, c3[1], 0.01);
    }

    @Test
    void rawCoordinatesRoundTrip() {
        // Center (0,0) → canonical (250,250) → region 5
        assertEquals(5, TeamMapRegionResolver.resolveRegionFromRaw(0, 0));
        // Top-left (-3000, 3000) → canonical (100, 400) → region 1
        assertEquals(1, TeamMapRegionResolver.resolveRegionFromRaw(-3000, 3000));
        // Bottom-right (3000, -3000) → canonical (400, 100) → region 9
        assertEquals(9, TeamMapRegionResolver.resolveRegionFromRaw(3000, -3000));
    }
}
