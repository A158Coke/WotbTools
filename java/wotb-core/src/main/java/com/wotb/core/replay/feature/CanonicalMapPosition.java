package com.wotb.core.replay.feature;

public record CanonicalMapPosition(float x, float z) {
    public CanonicalMapPosition {
        final float mapSize = MapCoordinateProfile.MAP_SIZE;
        if (!Float.isFinite(x) || !Float.isFinite(z)) {
            throw new IllegalArgumentException("Non-finite canonical position: " + x + "," + z);
        }
        if (x < 0 || x > mapSize) {
            throw new IllegalArgumentException("Canonical X out of range [0," + mapSize + "]: " + x);
        }
        if (z < 0 || z > mapSize) {
            throw new IllegalArgumentException("Canonical Z out of range [0," + mapSize + "]: " + z);
        }
    }

    public int region() {
        return MapRegionResolver.resolveRegion(x, z);
    }
}
