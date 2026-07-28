package com.wotb.core.replay.feature;

/**
 * Immutable coordinate calibration profile for raw→canonical map conversion.
 * The default profile is an experimental production calibration value.
 * It may be adjusted through deployment environment variables
 * ({@code REPLAY_COORDINATE_HALF_EXTENT}, {@code REPLAY_COORDINATE_CLAMP_TOLERANCE}).
 *
 * @param halfExtent    raw coordinate half-extent (must be finite > 0)
 * @param clampTolerance raw units beyond halfExtent allowed before INVALID (must be finite >= 0)
 */
public record MapCoordinateProfile(float halfExtent, float clampTolerance) {

    /**
     * Canonical map width/height in meters (fixed at 500×500).
     */
    public static final float MAP_SIZE = 500f;

    public static final MapCoordinateProfile DEFAULT = new MapCoordinateProfile(250f, 12.5f);

    public MapCoordinateProfile {
        if (!Float.isFinite(halfExtent) || halfExtent <= 0f) {
            throw new IllegalArgumentException("halfExtent must be finite and > 0: " + halfExtent);
        }
        if (!Float.isFinite(clampTolerance) || clampTolerance < 0f) {
            throw new IllegalArgumentException("clampTolerance must be finite and >= 0: " + clampTolerance);
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

    public float clampUpper() {
        return halfExtent + clampTolerance;
    }

    public float clampLower() {
        return -halfExtent - clampTolerance;
    }
}
