package com.wotb.core.replay.event;

public record AimRayStateEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        float worldYawDeg,
        float storedNegatedWorldPitchDeg,
        float aimRayPointX,
        float aimRayPointY,
        float aimRayPointZ,
        float relativeYawFamilyRawRad,
        float verticalStateFamilyRawRad
) implements ReplayEvent {

    public float worldPitchDeg() {
        return -storedNegatedWorldPitchDeg;
    }
}
