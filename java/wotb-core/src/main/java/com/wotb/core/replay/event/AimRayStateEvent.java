package com.wotb.core.replay.event;

/**
 * Type39 recorder aim/camera stream safe canonical event (11.19 only).
 *
 * <p>PR147 AFFIRMED：</p>
 * <ul>
 *   <li>f0 = world-space aim/gun-ray yaw in degrees</li>
 *   <li>f1 = stored negated world-space aim/gun-ray pitch in degrees</li>
 *   <li>f2/f3/f4 = world-space point on the current aim/projectile ray</li>
 * </ul>
 * f5/f6 remain raw limited-semantics fields and must not be exposed as exact turret/gun symbols
 * without viewpoint gating.
 */
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

    /** Safe derived sign conversion closed by PR147 projectile-launch cross-check. */
    public float worldPitchDeg() {
        return -storedNegatedWorldPitchDeg;
    }
}
