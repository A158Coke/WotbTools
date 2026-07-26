package com.wotb.core.replay.feature;

public final class MapRegionResolver {

    private MapRegionResolver() {}

    /** Canonical map width/height. */
    public static final float MAP_SIZE = 500f;

    /** Replay coordinate half-extent (±1000 per docs/replay-data.md). */
    static final float REPLAY_HALF_EXTENT = 1000f;

    /** Full replay coordinate range. */
    static final float REPLAY_RANGE = 2f * REPLAY_HALF_EXTENT;

    /**
     * Clamp tolerance for OUT_OF_BOUNDS_CLAMPED positions.
     * 5% of MAP_SIZE = 25 canonical meters = ~50 raw units.
     * Accounts for: replay interpolation, floating-point error, spawn offsets,
     * map texture vs playable-boundary differences, coarse-scale rounding.
     * Positions beyond this tolerance are INVALID, not CLAMPED.
     */
    public static final float CLAMP_TOLERANCE_RAW = 50f;

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

    /**
     * Convert raw replay coordinates to CanonicalMapPosition (deprecated).
     * Use {@link #resolve(float, float)} for full status semantics.
     * @deprecated Use resolve().position() instead.
     */
    @Deprecated
    public static CanonicalMapPosition toCanonical(final float x, final float z) {
        final MapCoordinateResolution res = resolve(x, z);
        return res.usable() ? res.position() : null;
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

    /** Unified max allowed raw coordinate (before valid/clamped split). */
    public static final float MAX_RAW_ALLOWED = CLAMP_UPPER;
}
