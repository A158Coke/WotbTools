package com.wotb.core.replay.feature;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class Type10MovementMathTest {

    private static final double EPS = 1e-6;

    @Test
    void planarSpeedMatchesControlledCalibration() {
        final double speedMps = Type10MovementMath.planarSpeedMps(15.8364, 0, 1.0);
        assertEquals(15.8364, speedMps, EPS);
        assertEquals(57.01104, Type10MovementMath.speedKmh(speedMps), 1e-3);
    }

    @Test
    void signedForwardSpeedDistinguishesForwardAndReverse() {
        final double forward = Type10MovementMath.signedForwardSpeedMps(0, 10, 1.0, 0.0);
        final double reverse = Type10MovementMath.signedForwardSpeedMps(0, -10, 1.0, 0.0);
        assertTrue(forward > 0);
        assertTrue(reverse < 0);
        assertEquals(10.0, forward, EPS);
        assertEquals(-10.0, reverse, EPS);
    }

    @Test
    void signedForwardSpeedUsesHeadingAxis() {
        final double speed = Type10MovementMath.signedForwardSpeedMps(10, 0, 1.0, Math.PI / 2);
        assertEquals(10.0, speed, EPS);
    }

    @Test
    void wrapPiNormalizesAcrossBoundary() {
        assertEquals(-Math.PI + 0.1, Type10MovementMath.wrapPi(Math.PI + 0.1), EPS);
        assertEquals(0.0, Type10MovementMath.wrapPi(0.0), EPS);
        assertEquals(0.0, Type10MovementMath.wrapPi(2.0 * Math.PI), EPS);
    }

    @Test
    void hullYawRateWrapsCorrectly() {
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
