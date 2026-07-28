package com.wotb.core.replay.feature;

public record CanonicalMapPosition(float x, float z) {
    public CanonicalMapPosition {
        if (!Float.isFinite(x) || !Float.isFinite(z)) {
            throw new IllegalArgumentException("Non-finite canonical position: " + x + "," + z);
        }
        if (x < 0 || x > MapRegionResolver.MAP_SIZE) {
            throw new IllegalArgumentException("Canonical X out of range [0," + MapRegionResolver.MAP_SIZE + "]: " + x);
        }
        if (z < 0 || z > MapRegionResolver.MAP_SIZE) {
            throw new IllegalArgumentException("Canonical Z out of range [0," + MapRegionResolver.MAP_SIZE + "]: " + z);
        }
    }

    public int region() {
        return MapRegionResolver.resolveRegion(x, z);
    }
}
