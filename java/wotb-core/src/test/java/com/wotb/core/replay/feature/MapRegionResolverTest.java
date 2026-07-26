package com.wotb.core.replay.feature;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

class MapRegionResolverTest {

    // Region layout:
    // 1 | 2 | 3  (top, Z > 333)
    // 4 | 5 | 6  (middle, 167 < Z <= 333)
    // 7 | 8 | 9  (bottom, Z <= 167)

    @Test void region1_topLeft() { assertEquals(1, MapRegionResolver.resolveRegion(50, 450)); }
    @Test void region2_topCenter() { assertEquals(2, MapRegionResolver.resolveRegion(200, 450)); }
    @Test void region3_topRight() { assertEquals(3, MapRegionResolver.resolveRegion(450, 450)); }
    @Test void region4_midLeft() { assertEquals(4, MapRegionResolver.resolveRegion(50, 200)); }
    @Test void region5_center() { assertEquals(5, MapRegionResolver.resolveRegion(250, 250)); }
    @Test void region6_midRight() { assertEquals(6, MapRegionResolver.resolveRegion(450, 200)); }
    @Test void region7_bottomLeft() { assertEquals(7, MapRegionResolver.resolveRegion(50, 50)); }
    @Test void region8_bottomCenter() { assertEquals(8, MapRegionResolver.resolveRegion(200, 50)); }
    @Test void region9_bottomRight() { assertEquals(9, MapRegionResolver.resolveRegion(450, 50)); }

    @Test void mapCorners() {
        assertEquals(1, MapRegionResolver.resolveRegion(0, 500));
        assertEquals(3, MapRegionResolver.resolveRegion(500, 500));
        assertEquals(7, MapRegionResolver.resolveRegion(0, 0));
        assertEquals(9, MapRegionResolver.resolveRegion(500, 0));
    }

    @Test void center() { assertEquals(5, MapRegionResolver.resolveRegion(250, 250)); }

    @Test void xBoundary() {
        assertEquals(1, MapRegionResolver.resolveRegion(166.66f, 450));
        assertEquals(2, MapRegionResolver.resolveRegion(166.67f, 450));
    }

    @Test void zBoundary() {
        assertEquals(4, MapRegionResolver.resolveRegion(50, 166.67f));
        assertEquals(7, MapRegionResolver.resolveRegion(50, 166.66f));
    }

    @Test void outOfBounds() {
        assertEquals(0, MapRegionResolver.resolveRegion(-1, 250));
        assertEquals(0, MapRegionResolver.resolveRegion(600, 250));
    }

    @Test void nan() { assertEquals(0, MapRegionResolver.resolveRegion(Float.NaN, 250)); }

    @Test void infinity() { assertEquals(0, MapRegionResolver.resolveRegion(Float.POSITIVE_INFINITY, 250)); }

    @Test void yDoesNotAffectRegion() {
        assertEquals(5, MapRegionResolver.resolveRegion(250, 250));
    }

    @Test void canonicalConversion() {
        final float[] c1 = MapRegionResolver.toCanonical(-1000, -1000);
        assertEquals(0f, c1[0], 0.01);
        final float[] c2 = MapRegionResolver.toCanonical(0, 0);
        assertEquals(250f, c2[0], 0.01);
        final float[] c3 = MapRegionResolver.toCanonical(1000, 1000);
        assertEquals(500f, c3[0], 0.01);
    }

    @Test void rawCoordinatesRoundTrip() {
        assertEquals(5, MapRegionResolver.resolveRegionFromRaw(0, 0));
        assertEquals(1, MapRegionResolver.resolveRegionFromRaw(-600, 600));
        assertEquals(9, MapRegionResolver.resolveRegionFromRaw(600, -600));
    }
}
