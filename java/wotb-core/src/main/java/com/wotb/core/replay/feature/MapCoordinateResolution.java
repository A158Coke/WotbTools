package com.wotb.core.replay.feature;

public record MapCoordinateResolution(Status status, CanonicalMapPosition position, int region) {

    public enum Status {VALID, CLAMPED, INVALID}

    public MapCoordinateResolution {
        if (status == null) throw new IllegalArgumentException("status must not be null");
        switch (status) {
            case VALID, CLAMPED -> {
                if (position == null) throw new IllegalArgumentException("VALID/CLAMPED must have non-null position");
                if (region < 1 || region > 9)
                    throw new IllegalArgumentException("VALID/CLAMPED region must be 1-9: " + region);
                if (position.region() != region)
                    throw new IllegalArgumentException("region " + region + " != position.region() " + position.region());
            }
            case INVALID -> {
                if (position != null) throw new IllegalArgumentException("INVALID must have null position");
                if (region != 0) throw new IllegalArgumentException("INVALID must have region 0");
            }
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
