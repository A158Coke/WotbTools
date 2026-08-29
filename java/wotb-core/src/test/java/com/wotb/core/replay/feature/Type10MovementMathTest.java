package com.wotb.core.replay.feature;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Type10 物理坐标契约（证据 type10-movement-transform-closure.md）。
 */
class Type10MovementMathTest {

    private static final double EPS = 1e-6;

    @Test
    void planarSpeedMatchesControlledCalibration() {
        // Kanonenjagdpanzer 105 forward median = 15.8364 unit/s → 57.011 km/h
        final double speedMps = Type10MovementMath.planarSpeedMps(15.8364, 0, 1.0);
        assertEquals(15.8364, speedMps, EPS);
        assertEquals(57.01104, Type10MovementMath.speedKmh(speedMps), 1e-3);
    }

    @Test
    void signedForwardSpeedDistinguishesForwardAndReverse() {
        // yaw=0：前向轴 = +z；沿 +z 移动为正，沿 -z 移动为负
        final double forward = Type10MovementMath.signedForwardSpeedMps(0, 10, 1.0, 0.0);
        final double reverse = Type10MovementMath.signedForwardSpeedMps(0, -10, 1.0, 0.0);
        assertTrue(forward > 0);
        assertTrue(reverse < 0);
        assertEquals(10.0, forward, EPS);
        assertEquals(-10.0, reverse, EPS);
    }

    @Test
    void signedForwardSpeedUsesHeadingAxis() {
        // yaw=π/2：前向轴 = +x
        final double speed = Type10MovementMath.signedForwardSpeedMps(10, 0, 1.0, Math.PI / 2);
        assertEquals(10.0, speed, EPS);
    }

    @Test
    void wrapPiNormalizesAcrossBoundary() {
        // π+0.1 归一化到 -π+0.1（同一角度，落在 (-π, π] 内）
        assertEquals(-Math.PI + 0.1, Type10MovementMath.wrapPi(Math.PI + 0.1), EPS);
        assertEquals(0.0, Type10MovementMath.wrapPi(0.0), EPS);
        assertEquals(0.0, Type10MovementMath.wrapPi(2.0 * Math.PI), EPS);
    }

    @Test
    void hullYawRateWrapsCorrectly() {
        // yaw1=π-0.1 → yaw2=-π+0.1：跨越 ±π 边界的微小同向旋转（真实 Δ=+0.2 rad），
        // 不能把 Δ 算成 ~±6.28
        final double rate = Type10MovementMath.hullYawRateRadS(Math.PI - 0.1, -Math.PI + 0.1, 1.0);
        assertEquals(0.2, rate, EPS);
    }

    @Test
    void invalidDeltaTimeYieldsNaN() {
        assertFalse(Double.isFinite(Type10MovementMath.planarSpeedMps(1, 1, 0)));
        assertFalse(Double.isFinite(Type10MovementMath.signedForwardSpeedMps(1, 1, -1, 0)));
        assertFalse(Double.isFinite(Type10MovementMath.hullYawRateRadS(0, 1, 0)));
    }
}
