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
 * Third boundaries are at 500/3 ≈ 166.67.
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

    /** One third of the map — the boundary between grid columns/rows. */
    private static final float THIRD = MAP_SIZE / 3f;

    /** Upper bound of region 1/2/3 (top third of Z). */
    private static final float Z_TOP = THIRD;

    /** Upper bound of region 4/5/6 (middle third of Z). */
    private static final float Z_MID = 2f * THIRD;

    /** Upper bound of region 7/8/9 (bottom third of Z). Maps to region below Z_MID. */

    /**
     * Convert replay coordinates to the canonical 500×500 coordinate system.
     * The replay coordinate system uses a different scale; this method
     * normalizes by scaling factor.
     * @param x raw replay X coordinate
     * @param z raw replay Z coordinate
     * @return array of [canonicalX, canonicalZ]
     */
    public static float[] toCanonical(final float x, final float z) {
        // The replay coordinate system uses a larger scale.
        // The canonical map is 500x500. Scale factor derived from
        // MAX_ABSOLUTE_MAP_COORDINATE = 5000 (see DefaultTeamBattleFeatureExtractor).
        final float scale = 500f / 5000f;
        return new float[]{x * scale, z * scale};
    }

    /**
     * Resolve the region number for a canonical (X, Z) coordinate.
     *
     * @param canonicalX canonical X in [0, 500]
     * @param canonicalZ canonical Z in [0, 500] (+Z = top)
     * @return region number 1-9, or 0 for invalid/unresolved coordinates
     */
    public static int resolveRegion(final float canonicalX, final float canonicalZ) {
        if (!Float.isFinite(canonicalX) || !Float.isFinite(canonicalZ)) return 0;
        if (canonicalX < 0 || canonicalX > MAP_SIZE) return 0;
        if (canonicalZ < 0 || canonicalZ > MAP_SIZE) return 0;

        final int col;
        if (canonicalX < Z_TOP) col = 0;
        else if (canonicalX < Z_MID) col = 1;
        else col = 2;

        final int row;
        if (canonicalZ > MAP_SIZE - Z_TOP) row = 0;       // Z > 333.33 → top row (1/2/3)
        else if (canonicalZ > MAP_SIZE - Z_MID) row = 1;  // Z > 166.67 → middle row (4/5/6)
        else row = 2;                                       // Z <= 166.67 → bottom row (7/8/9)

        return row * 3 + col + 1;
    }

    /**
     * Convenience: convert raw replay coordinates straight to region.
     */
    public static int resolveRegionFromRaw(final float rawX, final float rawZ) {
        final float[] canon = toCanonical(rawX, rawZ);
        return resolveRegion(canon[0], canon[1]);
    }
}
