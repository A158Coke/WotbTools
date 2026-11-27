package com.wotb.core.replay.timeline;

public record FrameOrientation(
        Float hullYawDeg,
        Float turretRelativeYawDeg,
        Float turretWorldYawDeg,
        Double observedAtSec,
        Double ageSec,
        OrientationKnowledge knowledge,
        Confidence confidence
) {
    public enum OrientationKnowledge {
        CURRENT,
        LAST_KNOWN,
        UNKNOWN
    }

    public static final FrameOrientation UNKNOWN =
            new FrameOrientation(null, null, null, null, null, OrientationKnowledge.UNKNOWN, Confidence.UNKNOWN);

    public static float normalizeDeg(final float deg) {
        float d = deg % 360f;
        if (d >= 180f) {
            d -= 360f;
        }
        if (d < -180f) {
            d += 360f;
        }
        return d;
    }
}
