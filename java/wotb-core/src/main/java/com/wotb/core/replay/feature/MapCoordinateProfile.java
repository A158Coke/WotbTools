package com.wotb.core.replay.feature;

/**
 * Immutable coordinate calibration profile for raw→canonical map conversion.
 * The default profile is an experimental production calibration value.
 * It may be adjusted through deployment environment variables
 * ({@code REPLAY_COORDINATE_HALF_EXTENT}, {@code REPLAY_COORDINATE_CLAMP_TOLERANCE}).
 *
 * @param halfExtent     raw coordinate half-extent (must be finite > 0)
 * @param clampTolerance raw units beyond halfExtent allowed before INVALID (must be finite >= 0)
 */
public record MapCoordinateProfile(float halfExtent, float clampTolerance,
                                   float centerX, float centerZ) {

    /**
     * Canonical map width/height in meters (fixed at 500×500).
     */
    public static final float MAP_SIZE = 500f;

    /**
     * Compatible default: origin-centered 250m half-extent (near-symmetric maps).
     */
    public static final MapCoordinateProfile DEFAULT =
            new MapCoordinateProfile(250f, 12.5f, 0f, 0f);

    public MapCoordinateProfile(float halfExtent, float clampTolerance) {
        this(halfExtent, clampTolerance, 0f, 0f);
    }

    public MapCoordinateProfile {
        if (!Float.isFinite(halfExtent) || halfExtent <= 0f) {
            throw new IllegalArgumentException("halfExtent must be finite and > 0: " + halfExtent);
        }
        if (!Float.isFinite(clampTolerance) || clampTolerance < 0f) {
            throw new IllegalArgumentException("clampTolerance must be finite and >= 0: " + clampTolerance);
        }
        if (!Float.isFinite(centerX) || !Float.isFinite(centerZ)) {
            throw new IllegalArgumentException("centerX/centerZ must be finite: " + centerX + "," + centerZ);
        }
    }

    public float range() {
        return 2f * halfExtent;
    }

    public float scale() {
        return MAP_SIZE / range();
    }

    public float maxRaw() {
        return halfExtent;
    }

    public float clampUpperX() {
        return centerX + halfExtent + clampTolerance;
    }

    public float clampLowerX() {
        return centerX - halfExtent - clampTolerance;
    }

    public float clampUpperZ() {
        return centerZ + halfExtent + clampTolerance;
    }

    public float clampLowerZ() {
        return centerZ - halfExtent - clampTolerance;
    }

    /**
     * Compatibility: widest X/Z upper bound (used by maxRawAllowed).
     */
    public float clampUpper() {
        return Math.max(clampUpperX(), clampUpperZ());
    }

    /**
     * Compatibility: narrowest X/Z lower bound.
     */
    public float clampLower() {
        return Math.min(clampLowerX(), clampLowerZ());
    }
}
