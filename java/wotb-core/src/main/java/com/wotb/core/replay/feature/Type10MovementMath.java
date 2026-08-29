package com.wotb.core.replay.feature;

/**
 * Type10 物理坐标契约与派生运动事实。
 *
 * <p>证据：docs/research/replay/type10-movement-transform-closure.md。
 * <ul>
 *   <li>1 Type10 position unit ≈ 1 meter（PROVEN controlled：
 *       Kanonenjagdpanzer 105 forward 15.8364 unit/s → 57.011 km/h）；</li>
 *   <li>heading 约定：forwardX = sin(yaw)、forwardZ = cos(yaw)；</li>
 *   <li>Type10 无直接速度向量——速度/角速度均为 derived fact（DERIVED_FROM_TYPE10）。</li>
 * </ul>
 *
 * <p>所有方法都是纯函数；{@code dt <= 0} 属于无效采样区间，返回 {@code NaN} 由调用方
 * 决定是否跳过（不得用 0 冒充观测值）。</p>
 */
public final class Type10MovementMath {

    /** m/s → km/h。 */
    public static final double MPS_TO_KMH = 3.6;

    private Type10MovementMath() {
    }

    /** 角度回绕到 (-π, π]。 */
    public static double wrapPi(final double rad) {
        double wrapped = Math.IEEEremainder(rad, 2.0 * Math.PI);
        if (wrapped <= -Math.PI) {
            wrapped += 2.0 * Math.PI;
        } else if (wrapped > Math.PI) {
            wrapped -= 2.0 * Math.PI;
        }
        return wrapped;
    }

    /** 水平平面距离（米）。 */
    public static double planarDistance(final double x1, final double z1,
                                        final double x2, final double z2) {
        final double dx = x2 - x1;
        final double dz = z2 - z1;
        return Math.sqrt(dx * dx + dz * dz);
    }

    /** 空间距离（米）。 */
    public static double spatialDistance(final double x1, final double y1, final double z1,
                                         final double x2, final double y2, final double z2) {
        final double dx = x2 - x1;
        final double dy = y2 - y1;
        final double dz = z2 - z1;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    /** 平面速度（m/s）。 */
    public static double planarSpeedMps(final double dx, final double dz, final double dt) {
        return dt > 0 ? Math.sqrt(dx * dx + dz * dz) / dt : Double.NaN;
    }

    /** 垂直速度（m/s，Y 向上为正）。 */
    public static double verticalSpeedMps(final double dy, final double dt) {
        return dt > 0 ? dy / dt : Double.NaN;
    }

    /** m/s → km/h。 */
    public static double speedKmh(final double speedMps) {
        return speedMps * MPS_TO_KMH;
    }

    /** heading 前向分量（forwardX = sin(yaw)）。 */
    public static double forwardX(final double yawRad) {
        return Math.sin(yawRad);
    }

    /** heading 前向分量（forwardZ = cos(yaw)）。 */
    public static double forwardZ(final double yawRad) {
        return Math.cos(yawRad);
    }

    /**
     * signed longitudinal speed：{@code (Δx * sin(yaw) + Δz * cos(yaw)) / Δt}。
     * 正值 = FORWARD，负值 = REVERSE（PROVEN controlled derived relationship）。
     */
    public static double signedForwardSpeedMps(final double dx, final double dz,
                                               final double dt, final double yawRad) {
        return dt > 0 ? (dx * Math.sin(yawRad) + dz * Math.cos(yawRad)) / dt : Double.NaN;
    }

    /** 车体偏航角速度（rad/s）：{@code wrapPi(yaw2 - yaw1) / Δt}。 */
    public static double hullYawRateRadS(final double yaw1, final double yaw2, final double dt) {
        return dt > 0 ? wrapPi(yaw2 - yaw1) / dt : Double.NaN;
    }
}
