package com.wotb.core.replay.feature;

/**
 * Resolves 500×500 canonical map coordinates into 9 grid regions.
 * <p>
 * Coordinate convention:
 * <ul>
 *   <li>X: horizontal axis</li>
 *   <li>Z: vertical axis (+Z = map north/top, -Z = map south/bottom)</li>
 *   <li>Y: height (NOT used for region or cluster plane distance)</li>
 * </ul>
 * Canonical map size: 500 × 500.
 * Replay coordinates are mapped from ±5000 (the PositionDecoder out-of-bounds
 * threshold) to 0…500.
 * <p>
 * Region numbering (top-to-bottom, left-to-right):
 * <pre>
 * 1 | 2 | 3
 * 4 | 5 | 6
 * 7 | 8 | 9
 * </pre>
 */
public final class TeamMapRegionResolver {

    private TeamMapRegionResolver() {}

    /** Canonical map width/height. */
    public static final float MAP_SIZE = 500f;

    /**
     * Half the replay coordinate extent. Derived from the PositionDecoder
     * out-of-bounds check ({@code abs(x|z) > 5000} → OUT_OF_BOUNDS warning).
     * The canonical 500×500 space maps linearly from -5000…+5000.
     */
    static final float REPLAY_HALF_EXTENT = 5000f;

    /** Replay coordinate range (from -5000 to +5000). */
    private static final float REPLAY_RANGE = 2f * REPLAY_HALF_EXTENT;

    /** One third of the map — the boundary between grid columns/rows. */
    private static final float THIRD = MAP_SIZE / 3f;

    /**
     * Convert replay coordinates to canonical 500×500 coordinate system.
     * Maps ±5000 → 0…500 linearly.
     */
    public static float[] toCanonical(final float x, final float z) {
        final float scale = MAP_SIZE / REPLAY_RANGE;
        final float cx = (x + REPLAY_HALF_EXTENT) * scale;
        final float cz = (z + REPLAY_HALF_EXTENT) * scale;
        return new float[]{cx, cz};
    }

    /**
     * Resolve the region number for a canonical (X, Z) coordinate.
     *
     * @param cx canonical X
     * @param cz canonical Z (+Z = top)
     * @return region number 1-9, or 0 for invalid/unresolved
     */
    public static int resolveRegion(final float cx, final float cz) {
        if (!Float.isFinite(cx) || !Float.isFinite(cz)) return 0;
        if (cx < 0 || cx > MAP_SIZE) return 0;
        if (cz < 0 || cz > MAP_SIZE) return 0;

        // Column: X < 166.67 → 0, X < 333.33 → 1, X >= 333.33 → 2
        final int col;
        if (cx < THIRD) col = 0;
        else if (cx < 2f * THIRD) col = 1;
        else col = 2;

        // Row: larger Z = top (row 0), smaller Z = bottom (row 2)
        final int row;
        if (cz > MAP_SIZE - THIRD) row = 0;        // Z > 333.33 → top
        else if (cz > MAP_SIZE - 2f * THIRD) row = 1; // Z > 166.67 → middle
        else row = 2;                                // Z <= 166.67 → bottom

        return row * 3 + col + 1;
    }

    /** Convenience: raw replay coordinates → region. */
    public static int resolveRegionFromRaw(final float rawX, final float rawZ) {
        final float[] canon = toCanonical(rawX, rawZ);
        return resolveRegion(canon[0], canon[1]);
    }
}
