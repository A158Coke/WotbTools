package com.wotb.core.replay.feature;

public final class Type10MovementMath {

    public static final double MPS_TO_KMH = 3.6;

    private Type10MovementMath() {
    }

    public static double wrapPi(final double rad) {
        double wrapped = Math.IEEEremainder(rad, 2.0 * Math.PI);
        if (wrapped <= -Math.PI) {
            wrapped += 2.0 * Math.PI;
        } else if (wrapped > Math.PI) {
            wrapped -= 2.0 * Math.PI;
        }
        return wrapped;
    }

    public static double planarDistance(final double x1, final double z1,
                                        final double x2, final double z2) {
        final double dx = x2 - x1;
        final double dz = z2 - z1;
        return Math.sqrt(dx * dx + dz * dz);
    }

    public static double spatialDistance(final double x1, final double y1, final double z1,
                                         final double x2, final double y2, final double z2) {
        final double dx = x2 - x1;
        final double dy = y2 - y1;
        final double dz = z2 - z1;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }

    public static double planarSpeedMps(final double dx, final double dz, final double dt) {
        return dt > 0 ? Math.sqrt(dx * dx + dz * dz) / dt : Double.NaN;
    }

    public static double verticalSpeedMps(final double dy, final double dt) {
        return dt > 0 ? dy / dt : Double.NaN;
    }

    public static double speedKmh(final double speedMps) {
        return speedMps * MPS_TO_KMH;
    }

    public static double forwardX(final double yawRad) {
        return Math.sin(yawRad);
    }

    public static double forwardZ(final double yawRad) {
        return Math.cos(yawRad);
    }

    public static double signedForwardSpeedMps(final double dx, final double dz,
                                               final double dt, final double yawRad) {
        return dt > 0 ? (dx * Math.sin(yawRad) + dz * Math.cos(yawRad)) / dt : Double.NaN;
    }

    public static double hullYawRateRadS(final double yaw1, final double yaw2, final double dt) {
        return dt > 0 ? wrapPi(yaw2 - yaw1) / dt : Double.NaN;
    }
}
