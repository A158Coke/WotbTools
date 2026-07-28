package com.wotb.core.replay.feature;

public final class MapRegionResolver {

    private MapRegionResolver() {}

    /** Canonical map width/height. */
    public static final float MAP_SIZE = 500f;

    /**
     * Raw replay coordinates are game-world meters with origin at map center.
     * Observed range: approximately -250 to +250 in X and Z.
     * Since MAP_SIZE=500 and raw range=500, the conversion is:
     *   canonical = raw + 250  (scale = 1.0, no compression).
     */
    static final float REPLAY_HALF_EXTENT = 250f;

    /** Full replay coordinate range (same as MAP_SIZE → scale = 1). */
    static final float REPLAY_RANGE = MAP_SIZE;

    /**
     * Clamp tolerance in raw (meter) units. 12.5 canonical meters ≈ 2.5% of MAP_SIZE.
     * With scale=1, raw tolerance = canonical tolerance.
     * Accounts for: replay interpolation, floating-point error, spawn offsets,
     * map texture vs playable-boundary differences, coarse-scale rounding.
     * Positions beyond this tolerance are INVALID, not CLAMPED.
     */
    public static final float CLAMP_TOLERANCE_RAW = 12.5f;

    private static final float MAX_RAW_COORDINATE = REPLAY_HALF_EXTENT;
    private static final float CLAMP_UPPER = MAX_RAW_COORDINATE + CLAMP_TOLERANCE_RAW;
    private static final float CLAMP_LOWER = -MAX_RAW_COORDINATE - CLAMP_TOLERANCE_RAW;

    private static final float THIRD = MAP_SIZE / 3f;

    /** Resolve raw replay coordinates into MapCoordinateResolution. */
    public static MapCoordinateResolution resolve(final float rawX, final float rawZ) {
        if (!Float.isFinite(rawX) || !Float.isFinite(rawZ)) {
            return MapCoordinateResolution.invalid();
        }
        if (rawX > CLAMP_UPPER || rawX < CLAMP_LOWER
                || rawZ > CLAMP_UPPER || rawZ < CLAMP_LOWER) {
            return MapCoordinateResolution.invalid();
        }
        final float clampedX = clampRaw(rawX);
        final float clampedZ = clampRaw(rawZ);
        final boolean wasClamped = clampedX != rawX || clampedZ != rawZ;
        final CanonicalMapPosition pos = toCanonicalPos(clampedX, clampedZ);
        if (wasClamped) {
            return MapCoordinateResolution.clamped(pos);
        }
        return MapCoordinateResolution.valid(pos);
    }

    private static float clampRaw(final float v) {
        if (v > MAX_RAW_COORDINATE) return MAX_RAW_COORDINATE;
        if (v < -MAX_RAW_COORDINATE) return -MAX_RAW_COORDINATE;
        return v;
    }

    private static CanonicalMapPosition toCanonicalPos(final float safeX, final float safeZ) {
        final float scale = MAP_SIZE / REPLAY_RANGE;
        float cx = (safeX + REPLAY_HALF_EXTENT) * scale;
        float cz = (safeZ + REPLAY_HALF_EXTENT) * scale;
        if (cx < 0) cx = 0;
        if (cx > MAP_SIZE) cx = MAP_SIZE;
        if (cz < 0) cz = 0;
        if (cz > MAP_SIZE) cz = MAP_SIZE;
        return new CanonicalMapPosition(cx, cz);
    }

    /** Resolve region from canonical (X, Z). */
    public static int resolveRegion(final float cx, final float cz) {
        if (!Float.isFinite(cx) || !Float.isFinite(cz)) return 0;
        if (cx < 0 || cx > MAP_SIZE) return 0;
        if (cz < 0 || cz > MAP_SIZE) return 0;

        final int col;
        if (cx < THIRD) col = 0;
        else if (cx < 2f * THIRD) col = 1;
        else col = 2;

        final int row;
        if (cz > MAP_SIZE - THIRD) row = 0;
        else if (cz > MAP_SIZE - 2f * THIRD) row = 1;
        else row = 2;

        return row * 3 + col + 1;
    }

    /** Convenience: raw replay coordinates → region. */
    public static int resolveRegionFromRaw(final float rawX, final float rawZ) {
        final MapCoordinateResolution res = resolve(rawX, rawZ);
        if (!res.usable()) return 0;
        return res.region();
    }

    /**
     * Canonical (500×500 meter) Euclidean distance between two raw replay XZ points.
     * Each endpoint is resolved/clamped to canonical BEFORE the distance is computed, so the
     * result is always expressed in canonical meters and never exceeds the map diagonal.
     * Y (elevation) never participates. Returns a negative sentinel ({@code -1f}) when either
     * endpoint is not resolvable (INVALID), so callers can reject unusable movement evidence.
     */
    public static float canonicalDistanceMeters(
            final float rawX1, final float rawZ1,
            final float rawX2, final float rawZ2) {
        final MapCoordinateResolution a = resolve(rawX1, rawZ1);
        final MapCoordinateResolution b = resolve(rawX2, rawZ2);
        if (!a.usable() || !b.usable()) {
            return -1f;
        }
        final float dx = a.position().x() - b.position().x();
        final float dz = a.position().z() - b.position().z();
        return (float) Math.sqrt(dx * dx + dz * dz);
    }

    /** Unified max raw coordinate allowed before INVALID (REPLAY_HALF_EXTENT + tolerance). */
    public static final float MAX_RAW_ALLOWED = CLAMP_UPPER;
}
