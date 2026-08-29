package com.wotb.core.replay.timeline;

/**
 * 车辆朝向（度）。hull yaw 来自 type-10 yaw（PROVEN 权威，弧度→度）；
 * 炮塔相对车体偏航来自 type-7 propId=2（u16*360/65536-180，PROVEN）；
 * 炮塔世界偏航 = normalize(hull + relative)。
 * 方向只能作为 DERIVED spatial relation，不能直接声称「正在瞄准」（docs/architecture/battle-timeline.md §17）。
 *
 * <p><b>knowledge</b>（V2）：敌方离开 AoI（UNKNOWN_AOI gap）后方向必须从 {@code CURRENT}
 * 降为 {@code LAST_KNOWN}，不能继续表现为实时炮塔方向；{@code observedAtSec/ageSec} 附带
 * 最后观测时刻。</p>
 */
public record FrameOrientation(
        Float hullYawDeg,
        Float turretRelativeYawDeg,
        Float turretWorldYawDeg,
        Double observedAtSec,
        Double ageSec,
        OrientationKnowledge knowledge,
        Confidence confidence
) {
    /**
     * 方向知识状态。
     * <ul>
     *   <li>{@link #CURRENT} —— t 在 open observed segment 内，方向为当前可证明值；</li>
     *   <li>{@link #LAST_KNOWN} —— t 在 UNKNOWN_AOI gap（敌方离开 AoI），只保留最后已知方向 + age；</li>
     *   <li>{@link #UNKNOWN} —— 从未观测到方向。</li>
     * </ul>
     */
    public enum OrientationKnowledge {
        CURRENT,
        LAST_KNOWN,
        UNKNOWN
    }

    public static final FrameOrientation UNKNOWN =
            new FrameOrientation(null, null, null, null, null, OrientationKnowledge.UNKNOWN, Confidence.UNKNOWN);

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
