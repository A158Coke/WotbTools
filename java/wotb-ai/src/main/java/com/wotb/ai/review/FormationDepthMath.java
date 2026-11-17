package com.wotb.ai.review;

import java.util.List;

/** Small pure helpers shared by formation and relative-depth evidence. */
final class FormationDepthMath {

    private FormationDepthMath() {
    }

    static double[] centroid(final List<double[]> points) {
        if (points == null || points.isEmpty()) {
            return new double[]{0, 0};
        }
        double x = 0, z = 0;
        for (final double[] point : points) {
            x += point[0];
            z += point[1];
        }
        return new double[]{x / points.size(), z / points.size()};
    }

    static String fmt(final double sec) {
        return String.valueOf(Math.round(sec * 100.0) / 100.0);
    }
}
