package com.wotb.core.replay.feature;

public record MapCoordinateResolution(Status status, CanonicalMapPosition position, int region) {

    public enum Status { VALID, CLAMPED, INVALID }

    public MapCoordinateResolution {
        if (status == Status.INVALID) {
            position = null;
            region = 0;
        }
    }

    public static MapCoordinateResolution valid(final CanonicalMapPosition pos) {
        return new MapCoordinateResolution(Status.VALID, pos, pos.region());
    }

    public static MapCoordinateResolution clamped(final CanonicalMapPosition pos) {
        return new MapCoordinateResolution(Status.CLAMPED, pos, pos.region());
    }

    public static MapCoordinateResolution invalid() {
        return new MapCoordinateResolution(Status.INVALID, null, 0);
    }

    public boolean usable() {
        return status != Status.INVALID;
    }
}
