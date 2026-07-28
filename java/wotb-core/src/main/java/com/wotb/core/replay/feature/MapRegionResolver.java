package com.wotb.core.replay.feature;

public final class MapRegionResolver {

    private static volatile MapCoordinateProfile activeProfile = MapCoordinateProfile.DEFAULT;

    private MapRegionResolver() {}

    /** Configure the active coordinate profile (called from web layer at startup). */
    public static void configure(final MapCoordinateProfile profile) {
        activeProfile = profile;
    }

    /** Get the currently active coordinate profile. */
    public static MapCoordinateProfile activeProfile() {
        return activeProfile;
    }

    /**
     * Profile-aware resolve of raw replay coordinates into MapCoordinateResolution.
     */
    public static MapCoordinateResolution resolve(final float rawX, final float rawZ,
                                                  final MapCoordinateProfile profile) {
        if (!Float.isFinite(rawX) || !Float.isFinite(rawZ)) {
            return MapCoordinateResolution.invalid();
        }
        final float clampUpper = profile.clampUpper();
        final float clampLower = profile.clampLower();
        if (rawX > clampUpper || rawX < clampLower
                || rawZ > clampUpper || rawZ < clampLower) {
            return MapCoordinateResolution.invalid();
        }
        final float half = profile.halfExtent();
        final float clampedX = clampRaw(rawX, half);
        final float clampedZ = clampRaw(rawZ, half);
        final boolean wasClamped = clampedX != rawX || clampedZ != rawZ;
        final CanonicalMapPosition pos = toCanonicalPos(clampedX, clampedZ, profile);
        if (wasClamped) {
            return MapCoordinateResolution.clamped(pos);
        }
        return MapCoordinateResolution.valid(pos);
    }

    private static float clampRaw(final float v, final float halfExtent) {
        if (v > halfExtent) return halfExtent;
        if (v < -halfExtent) return -halfExtent;
        return v;
    }

    private static CanonicalMapPosition toCanonicalPos(final float safeX, final float safeZ,
                                                       final MapCoordinateProfile profile) {
        final float scale = profile.scale();
        final float half = profile.halfExtent();
        final float mapSize = MapCoordinateProfile.MAP_SIZE;
        float cx = (safeX + half) * scale;
        float cz = (safeZ + half) * scale;
        if (cx < 0) cx = 0;
        if (cx > mapSize) cx = mapSize;
        if (cz < 0) cz = 0;
        if (cz > mapSize) cz = mapSize;
        return new CanonicalMapPosition(cx, cz);
    }

    /** Resolve region from canonical (X, Z). */
    public static int resolveRegion(final float cx, final float cz) {
        final float mapSize = MapCoordinateProfile.MAP_SIZE;
        if (!Float.isFinite(cx) || !Float.isFinite(cz)) return 0;
        if (cx < 0 || cx > mapSize) return 0;
        if (cz < 0 || cz > mapSize) return 0;

        final float third = mapSize / 3f;
        final int col;
        if (cx < third) col = 0;
        else if (cx < 2f * third) col = 1;
        else col = 2;

        final int row;
        if (cz > mapSize - third) row = 0;
        else if (cz > mapSize - 2f * third) row = 1;
        else row = 2;

        return row * 3 + col + 1;
    }

    /** Convenience using default profile. */
    public static MapCoordinateResolution resolve(final float rawX, final float rawZ) {
        return resolve(rawX, rawZ, MapCoordinateProfile.DEFAULT);
    }

    /** Convenience: raw replay coordinates → region (default profile). */
    public static int resolveRegionFromRaw(final float rawX, final float rawZ) {
        return resolveRegionFromRaw(rawX, rawZ, MapCoordinateProfile.DEFAULT);
    }

    /** Profile-aware: raw replay coordinates → region. */
    public static int resolveRegionFromRaw(final float rawX, final float rawZ,
                                           final MapCoordinateProfile profile) {
        final MapCoordinateResolution res = resolve(rawX, rawZ, profile);
        if (!res.usable()) return 0;
        return res.region();
    }

    /**
     * Canonical Euclidean distance between two raw replay XZ points.
     * Uses the given profile for conversion.
     */
    public static float canonicalDistanceMeters(
            final float rawX1, final float rawZ1,
            final float rawX2, final float rawZ2,
            final MapCoordinateProfile profile) {
        final MapCoordinateResolution a = resolve(rawX1, rawZ1, profile);
        final MapCoordinateResolution b = resolve(rawX2, rawZ2, profile);
        if (!a.usable() || !b.usable()) {
            return -1f;
        }
        final float dx = a.position().x() - b.position().x();
        final float dz = a.position().z() - b.position().z();
        return (float) Math.sqrt(dx * dx + dz * dz);
    }

    /** Convenience using default profile. */
    public static float canonicalDistanceMeters(
            final float rawX1, final float rawZ1,
            final float rawX2, final float rawZ2) {
        return canonicalDistanceMeters(rawX1, rawZ1, rawX2, rawZ2, MapCoordinateProfile.DEFAULT);
    }

    /** Allowed raw coordinate limit for detection purposes (clampUpper). */
    public static float maxRawAllowed(final MapCoordinateProfile profile) {
        return profile.clampUpper();
    }
}
