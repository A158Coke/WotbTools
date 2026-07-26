package com.wotb.core.replay.feature;

public final class MapRegionResolver {

    private MapRegionResolver() {}

    public static final float MAP_SIZE = 500f;

    static final float REPLAY_HALF_EXTENT = 1000f;

    static final float REPLAY_RANGE = 2f * REPLAY_HALF_EXTENT;

    static final float MAX_RAW_COORDINATE = REPLAY_HALF_EXTENT;

    private static final float THIRD = MAP_SIZE / 3f;

    private static float clampRaw(final float v) {
        if (!Float.isFinite(v)) return Float.NaN;
        if (v > MAX_RAW_COORDINATE) return MAX_RAW_COORDINATE;
        if (v < -MAX_RAW_COORDINATE) return -MAX_RAW_COORDINATE;
        return v;
    }

    public static CanonicalMapPosition toCanonical(final float x, final float z) {
        final float safeX = clampRaw(x);
        final float safeZ = clampRaw(z);
        if (Float.isNaN(safeX) || Float.isNaN(safeZ)) {
            return null;
        }
        final float scale = MAP_SIZE / REPLAY_RANGE;
        float cx = (safeX + REPLAY_HALF_EXTENT) * scale;
        float cz = (safeZ + REPLAY_HALF_EXTENT) * scale;
        if (cx < 0) cx = 0;
        if (cx > MAP_SIZE) cx = MAP_SIZE;
        if (cz < 0) cz = 0;
        if (cz > MAP_SIZE) cz = MAP_SIZE;
        return new CanonicalMapPosition(cx, cz);
    }

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

    public static int resolveRegionFromRaw(final float rawX, final float rawZ) {
        final CanonicalMapPosition pos = toCanonical(rawX, rawZ);
        if (pos == null) return 0;
        return pos.region();
    }
}
