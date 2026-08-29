package com.wotb.core.replay.timeline;

/**
 * 车辆朝向（度）。hull yaw 来自 type-10 yaw（PROVEN 权威，弧度→度）；
 * 炮塔相对车体偏航来自 type-7 propId=2（u16*360/65536-180，PROVEN）；
 * 炮塔世界偏航 = normalize(hull + relative)。
 * 方向只能作为 DERIVED spatial relation，不能直接声称「正在瞄准」（docs/architecture/battle-timeline.md §17）。
 */
public record FrameOrientation(
        Float hullYawDeg,
        Float turretRelativeYawDeg,
        Float turretWorldYawDeg,
        Double observedAtSec
) {
    public static final FrameOrientation UNKNOWN = new FrameOrientation(null, null, null, null);

    /** normalize 到 [-180,180)。 */
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
