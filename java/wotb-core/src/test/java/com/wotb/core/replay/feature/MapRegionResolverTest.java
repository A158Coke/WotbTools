package com.wotb.core.replay.feature;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MapRegionResolverTest {

    // Region layout:
    // 1 | 2 | 3  (top, Z > 333)
    // 4 | 5 | 6  (middle, 167 < Z <= 333)
    // 7 | 8 | 9  (bottom, Z <= 167)

    @Test
    void region1_topLeft() {
        assertEquals(1, MapRegionResolver.resolveRegion(50, 450));
    }

    @Test
    void region2_topCenter() {
        assertEquals(2, MapRegionResolver.resolveRegion(200, 450));
    }

    @Test
    void region3_topRight() {
        assertEquals(3, MapRegionResolver.resolveRegion(450, 450));
    }

    @Test
    void region4_midLeft() {
        assertEquals(4, MapRegionResolver.resolveRegion(50, 200));
    }

    @Test
    void region5_center() {
        assertEquals(5, MapRegionResolver.resolveRegion(250, 250));
    }

    @Test
    void region6_midRight() {
        assertEquals(6, MapRegionResolver.resolveRegion(450, 200));
    }

    @Test
    void region7_bottomLeft() {
        assertEquals(7, MapRegionResolver.resolveRegion(50, 50));
    }

    @Test
    void region8_bottomCenter() {
        assertEquals(8, MapRegionResolver.resolveRegion(200, 50));
    }

    @Test
    void region9_bottomRight() {
        assertEquals(9, MapRegionResolver.resolveRegion(450, 50));
    }

    @Test
    void mapCorners() {
        assertEquals(1, MapRegionResolver.resolveRegion(0, 500));
        assertEquals(3, MapRegionResolver.resolveRegion(500, 500));
        assertEquals(7, MapRegionResolver.resolveRegion(0, 0));
        assertEquals(9, MapRegionResolver.resolveRegion(500, 0));
    }

    @Test
    void center() {
        assertEquals(5, MapRegionResolver.resolveRegion(250, 250));
    }

    @Test
    void xBoundary() {
        assertEquals(1, MapRegionResolver.resolveRegion(166.66f, 450));
        assertEquals(2, MapRegionResolver.resolveRegion(166.67f, 450));
    }

    @Test
    void zBoundary() {
        assertEquals(4, MapRegionResolver.resolveRegion(50, 166.67f));
        assertEquals(7, MapRegionResolver.resolveRegion(50, 166.66f));
    }

    @Test
    void outOfBounds() {
        assertEquals(0, MapRegionResolver.resolveRegion(-1, 250));
        assertEquals(0, MapRegionResolver.resolveRegion(600, 250));
    }

    @Test
    void nan() {
        assertEquals(0, MapRegionResolver.resolveRegion(Float.NaN, 250));
    }

    @Test
    void infinity() {
        assertEquals(0, MapRegionResolver.resolveRegion(Float.POSITIVE_INFINITY, 250));
    }

    @Test
    void yDoesNotAffectRegion() {
        assertEquals(5, MapRegionResolver.resolveRegion(250, 250));
    }

    @Test
    void canonicalConversion() {
        final MapCoordinateResolution r1 = MapRegionResolver.resolve(-250, -250);
        assertEquals(MapCoordinateResolution.Status.VALID, r1.status());
        assertEquals(0f, r1.position().x(), 0.01);
        assertEquals(0f, r1.position().z(), 0.01);
        final MapCoordinateResolution r2 = MapRegionResolver.resolve(0, 0);
        assertEquals(MapCoordinateResolution.Status.VALID, r2.status());
        assertEquals(250f, r2.position().x(), 0.01);
        assertEquals(250f, r2.position().z(), 0.01);
        final MapCoordinateResolution r3 = MapRegionResolver.resolve(250, 250);
        assertEquals(MapCoordinateResolution.Status.VALID, r3.status());
        assertEquals(500f, r3.position().x(), 0.01);
        assertEquals(500f, r3.position().z(), 0.01);
    }

    @Test
    void rawCoordinatesRoundTrip() {
        assertEquals(5, MapRegionResolver.resolveRegionFromRaw(0, 0));
        assertEquals(1, MapRegionResolver.resolveRegionFromRaw(-250, 250));
        assertEquals(9, MapRegionResolver.resolveRegionFromRaw(250, -250));
    }

    @Test
    void nanInputReturnsNull() {
        assertEquals(MapCoordinateResolution.Status.INVALID, MapRegionResolver.resolve(Float.NaN, 250).status());
        assertEquals(MapCoordinateResolution.Status.INVALID, MapRegionResolver.resolve(Float.POSITIVE_INFINITY, 250).status());
    }

    @Test
    void outOfRangeRawClampedToCanonical() {
        assertEquals(MapCoordinateResolution.Status.INVALID, MapRegionResolver.resolve(5000, 5000).status());
        final MapCoordinateResolution res = MapRegionResolver.resolve(255, 255);
        assertEquals(MapCoordinateResolution.Status.CLAMPED, res.status());
        assertNotNull(res.position());
        assertTrue(res.position().x() >= 0 && res.position().x() <= 500);
        assertTrue(res.position().z() >= 0 && res.position().z() <= 500);
        assertEquals(500f, res.position().x(), 0.01);
        assertEquals(500f, res.position().z(), 0.01);
    }

    @Test
    void resolveAllRegions() {
        assertEquals(1, MapRegionResolver.resolve(-250, 250).region());
        assertEquals(2, MapRegionResolver.resolve(0, 250).region());
        assertEquals(3, MapRegionResolver.resolve(250, 250).region());
        assertEquals(4, MapRegionResolver.resolve(-250, 0).region());
        assertEquals(5, MapRegionResolver.resolve(0, 0).region());
        assertEquals(6, MapRegionResolver.resolve(250, 0).region());
        assertEquals(7, MapRegionResolver.resolve(-250, -250).region());
        assertEquals(8, MapRegionResolver.resolve(0, -250).region());
        assertEquals(9, MapRegionResolver.resolve(250, -250).region());
    }

    // === MapCoordinateResolution VALID/CLAMPED/INVALID ===

    @Test
    void validPosition() {
        final MapCoordinateResolution r = MapRegionResolver.resolve(0, 0);
        assertEquals(MapCoordinateResolution.Status.VALID, r.status());
        assertEquals(5, r.region());
        assertTrue(r.usable());
    }

    @Test
    void validAtBoundary() {
        assertEquals(MapCoordinateResolution.Status.VALID, MapRegionResolver.resolve(-250, -250).status());
        assertEquals(MapCoordinateResolution.Status.VALID, MapRegionResolver.resolve(250, 250).status());
    }

    @Test
    void clampedSlightOverflow() {
        final MapCoordinateResolution r = MapRegionResolver.resolve(255, -255);
        assertEquals(MapCoordinateResolution.Status.CLAMPED, r.status());
        assertTrue(r.usable());
        assertEquals(500f, r.position().x(), 0.01);
        assertEquals(0f, r.position().z(), 0.01);
    }

    @Test
    void invalidLargeOverflow() {
        assertEquals(MapCoordinateResolution.Status.INVALID, MapRegionResolver.resolve(5000, 0).status());
        assertFalse(MapRegionResolver.resolve(5000, 0).usable());
        assertEquals(0, MapRegionResolver.resolve(5000, 0).region());
    }

    @Test
    void invalidNan() {
        assertEquals(MapCoordinateResolution.Status.INVALID, MapRegionResolver.resolve(Float.NaN, 0).status());
    }

    @Test
    void invalidInfinity() {
        assertEquals(MapCoordinateResolution.Status.INVALID, MapRegionResolver.resolve(Float.POSITIVE_INFINITY, 0).status());
    }

    @Test
    void clampedExactlyAtTolerance() {
        assertEquals(MapCoordinateResolution.Status.CLAMPED, MapRegionResolver.resolve(262.5f, -262.5f).status());
        assertTrue(MapRegionResolver.resolve(262.5f, -262.5f).usable());
    }

    @Test
    void invalidBeyondTolerance() {
        assertEquals(MapCoordinateResolution.Status.INVALID, MapRegionResolver.resolve(263f, 0).status());
        assertEquals(MapCoordinateResolution.Status.INVALID, MapRegionResolver.resolve(-263f, 0).status());
    }

    @Test
    void sameResultForBothScopesViaResolve() {
        final MapCoordinateResolution r = MapRegionResolver.resolve(-200, 200);
        assertEquals(MapCoordinateResolution.Status.VALID, r.status());
        assertEquals(1, r.region());
    }

    @Test
    void clampedProducesRegionOnEdge() {
        final MapCoordinateResolution r = MapRegionResolver.resolve(260, 0);
        assertEquals(MapCoordinateResolution.Status.CLAMPED, r.status());
        assertEquals(6, r.region());
    }

    @Test
    void invalidYieldsNoRegion() {
        assertEquals(0, MapRegionResolver.resolve(5000, 0).region());
        assertEquals(0, MapRegionResolver.resolve(Float.NaN, 0).region());
    }

    // === Active-profile propagation tests ===

    @Test
    void convenienceMethodsUseActiveProfile() {
        final MapCoordinateProfile original = MapRegionResolver.activeProfile();
        try {
            // halfExtent=500: raw ±500 maps to canonical 0-500
            MapRegionResolver.configure(new MapCoordinateProfile(500f, 25f));
            MapCoordinateResolution r = MapRegionResolver.resolve(0f, 0f);
            assertEquals(MapCoordinateResolution.Status.VALID, r.status());
            assertEquals(250f, r.position().x(), 0.01f);
            assertEquals(5, MapRegionResolver.resolveRegionFromRaw(0f, 0f));

            // halfExtent=1000: raw ±1000 maps to canonical 0-500
            MapRegionResolver.configure(new MapCoordinateProfile(1000f, 50f));
            r = MapRegionResolver.resolve(0f, 0f);
            assertEquals(MapCoordinateResolution.Status.VALID, r.status());
            assertEquals(250f, r.position().x(), 0.01f);
            assertEquals(5, MapRegionResolver.resolveRegionFromRaw(0f, 0f));

            // canonicalDistanceMeters also uses active profile
            MapRegionResolver.configure(new MapCoordinateProfile(250f, 12.5f));
            assertEquals(100f, MapRegionResolver.canonicalDistanceMeters(0f, 0f, 100f, 0f), 0.01f);
        } finally {
            MapRegionResolver.configure(original);
        }
    }

    @Test
    void activeProfileChangesCanonicalScale() {
        final MapCoordinateProfile original = MapRegionResolver.activeProfile();
        try {
            // halfExtent=1000 → scale = 500/2000 = 0.25
            // raw = +400 → canonical = (400+1000)*0.25 = 350
            MapRegionResolver.configure(new MapCoordinateProfile(1000f, 50f));
            MapCoordinateResolution r = MapRegionResolver.resolve(400f, 400f);
            assertEquals(MapCoordinateResolution.Status.VALID, r.status());
            assertEquals(350f, r.position().x(), 0.01f);
            assertEquals(350f, r.position().z(), 0.01f);

            // halfExtent=250 → scale = 500/500 = 1.0
            // raw = +400 → canonical = 400+250 = 650 → clamped to 500
            MapRegionResolver.configure(new MapCoordinateProfile(250f, 12.5f));
            r = MapRegionResolver.resolve(400f, 400f);
            // 400 > 262.5 → INVALID (beyond clamp tolerance)
            assertEquals(MapCoordinateResolution.Status.INVALID, r.status());

            // halfExtent=500 → scale = 500/1000 = 0.5
            // raw = +400 → canonical = (400+500)*0.5 = 450
            MapRegionResolver.configure(new MapCoordinateProfile(500f, 25f));
            r = MapRegionResolver.resolve(400f, 400f);
            assertEquals(MapCoordinateResolution.Status.VALID, r.status());
            assertEquals(450f, r.position().x(), 0.01f);
            assertEquals(450f, r.position().z(), 0.01f);
        } finally {
            MapRegionResolver.configure(original);
        }
    }

    // === Nine-region grid from canonical coordinates ===
    // X: 0→500 (left→right), Z: 0→500 (bottom→top)
    // Grid:  1|2|3 top, 4|5|6 middle, 7|8|9 bottom
    // Each cell = 166.66... wide × 166.66... tall

    @Test
    void assertRegion1() {
        assertEquals(1, MapRegionResolver.resolveRegion(0f, 500f));
    }

    @Test
    void assertRegion2() {
        assertEquals(2, MapRegionResolver.resolveRegion(250f, 500f));
    }

    @Test
    void assertRegion3() {
        assertEquals(3, MapRegionResolver.resolveRegion(500f, 500f));
    }

    @Test
    void assertRegion4() {
        assertEquals(4, MapRegionResolver.resolveRegion(0f, 250f));
    }

    @Test
    void assertRegion5() {
        assertEquals(5, MapRegionResolver.resolveRegion(250f, 250f));
    }

    @Test
    void assertRegion6() {
        assertEquals(6, MapRegionResolver.resolveRegion(500f, 250f));
    }

    @Test
    void assertRegion7() {
        assertEquals(7, MapRegionResolver.resolveRegion(0f, 0f));
    }

    @Test
    void assertRegion8() {
        assertEquals(8, MapRegionResolver.resolveRegion(250f, 0f));
    }

    @Test
    void assertRegion9() {
        assertEquals(9, MapRegionResolver.resolveRegion(500f, 0f));
    }

    // === Raw → region: nine canonical positions from raw ±250 ===

    @Test
    void rawRegion1() {
        assertEquals(1, MapRegionResolver.resolveRegionFromRaw(-250f, 250f));
    }

    @Test
    void rawRegion2() {
        assertEquals(2, MapRegionResolver.resolveRegionFromRaw(0f, 250f));
    }

    @Test
    void rawRegion3() {
        assertEquals(3, MapRegionResolver.resolveRegionFromRaw(250f, 250f));
    }

    @Test
    void rawRegion4() {
        assertEquals(4, MapRegionResolver.resolveRegionFromRaw(-250f, 0f));
    }

    @Test
    void rawRegion5() {
        assertEquals(5, MapRegionResolver.resolveRegionFromRaw(0f, 0f));
    }

    @Test
    void rawRegion6() {
        assertEquals(6, MapRegionResolver.resolveRegionFromRaw(250f, 0f));
    }

    @Test
    void rawRegion7() {
        assertEquals(7, MapRegionResolver.resolveRegionFromRaw(-250f, -250f));
    }

    @Test
    void rawRegion8() {
        assertEquals(8, MapRegionResolver.resolveRegionFromRaw(0f, -250f));
    }

    @Test
    void rawRegion9() {
        assertEquals(9, MapRegionResolver.resolveRegionFromRaw(250f, -250f));
    }

    // === Route regression: near right edge moving down ===
    // User observed: start near right edge in region 6, move down to region 9
    // Raw X ≈ +230 (canonical ≈ 480), raw Z from 0 (canonical 250) → -230 (canonical 20)

    @Test
    void routeStartRegion6() {
        assertEquals(6, MapRegionResolver.resolveRegionFromRaw(230f, 0f));
    }

    @Test
    void routeMiddleRegion9() {
        assertEquals(9, MapRegionResolver.resolveRegionFromRaw(230f, -120f));
    }

    @Test
    void routeEndRegion9() {
        assertEquals(9, MapRegionResolver.resolveRegionFromRaw(230f, -230f));
    }

    @Test
    void routeFullRawResolution() {
        // Start: raw (+230, 0) → canonical (480, 250) → region 6
        MapCoordinateResolution res = MapRegionResolver.resolve(230f, 0f);
        assertEquals(MapCoordinateResolution.Status.VALID, res.status());
        assertEquals(6, res.region(), "Right edge at mid-height must be region 6");

        // End: raw (+230, -230) → canonical (480, 20) → region 9
        res = MapRegionResolver.resolve(230f, -230f);
        assertEquals(MapCoordinateResolution.Status.VALID, res.status());
        assertEquals(9, res.region(), "Right edge near bottom must be region 9, not 5");
    }

    // === Per-map profile: asymmetric maps must not be clamped by the +/-250 default ===

    @Test
    void perMapNeptuneUsesCenteredProfile() {
        // neptune playableBounds x[-287.0,274.0] y[-275.4,276.6]
        final MapCoordinateResolution res = MapRegionResolver.resolve(-280f, -270f, "neptune");
        assertTrue(res.usable(), "neptune left edge (-280) must be in-range with per-map profile");
        final MapCoordinateResolution def = MapRegionResolver.resolve(-280f, -270f, "no_such_map");
        assertFalse(def.usable(), "default profile must reject -280 (outside +/-250+tolerance)");
    }

    @Test
    void perMapHimmelsdorfLeftEdgeUsable() {
        final MapCoordinateResolution res = MapRegionResolver.resolve(-259f, 0f, "himmelsdorf");
        assertTrue(res.usable());
        assertTrue(res.position().x() < 250f, "left edge must map to left half of canonical map");
    }

    @Test
    void perMapDistanceUsesSameProfile() {
        final float d = MapRegionResolver.canonicalDistanceMeters(
                -280f, -270f, 274f, 276f, "neptune");
        assertTrue(d > 500f, "neptune full width must be ~554m canonical, got " + d);
        final float dDefault = MapRegionResolver.canonicalDistanceMeters(
                -280f, -270f, 274f, 276f, "no_such_map");
        assertTrue(dDefault < 0f, "default profile must reject out-of-range endpoints");
    }
}
