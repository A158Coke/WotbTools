package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.reconstruction.Vector3;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MovementSegmentTest {

    @Test
    void forwardSegmentDerivesKmhAndForwardState() {
        final MovementSegment seg = MovementSegment.derived(
                10f, 12f, MovementType.MOVING,
                new Vector3(0f, 0f, 0f), new Vector3(0f, 0f, 30f),
                30f, 15f, DecodeConfidence.EXACT, 0f, 0f);
        assertEquals(54f, seg.averageSpeedKmh(), 0.01f);
        assertEquals(MovementState.FORWARD, seg.movementState());
        assertEquals(0f, seg.verticalDeltaMeters(), 1e-6f);
        assertEquals(0f, seg.verticalSpeedMps(), 1e-6f);
        assertEquals(0f, seg.hullYawRateRadS(), 1e-6f);
    }

    @Test
    void reverseSegmentDerivesReverseState() {
        final MovementSegment seg = MovementSegment.derived(
                10f, 12f, MovementType.MOVING,
                new Vector3(0f, 0f, 0f), new Vector3(0f, 0f, 30f),
                30f, 15f, DecodeConfidence.EXACT, (float) Math.PI, (float) Math.PI);
        assertEquals(MovementState.REVERSE, seg.movementState());
    }

    @Test
    void turningSegmentDerivesYawRate() {
        final MovementSegment seg = MovementSegment.derived(
                10f, 12f, MovementType.MOVING,
                new Vector3(0f, 0f, 0f), new Vector3(0.1f, 0f, 0.1f),
                0.14f, 0.07f, DecodeConfidence.EXACT,
                0f, (float) (Math.PI / 2.0));
        assertEquals((float) (Math.PI / 4.0), seg.hullYawRateRadS(), 0.01f);
        assertEquals(MovementState.TURNING, seg.movementState());
    }

    @Test
    void verticalMovementDerivesDeltaAndSpeed() {
        final MovementSegment seg = MovementSegment.derived(
                10f, 12f, MovementType.MOVING,
                new Vector3(0f, 0f, 0f), new Vector3(10f, 8f, 0f),
                10f, 5f, DecodeConfidence.EXACT, 0f, 0f);
        assertEquals(8f, seg.verticalDeltaMeters(), 1e-6f);
        assertEquals(4f, seg.verticalSpeedMps(), 1e-6f);
    }

    @Test
    void unknownYawYieldsNanDerivedScalars() {
        final MovementSegment seg = MovementSegment.derived(
                10f, 12f, MovementType.MOVING,
                new Vector3(0f, 0f, 0f), new Vector3(10f, 0f, 0f),
                10f, 5f, DecodeConfidence.EXACT, Float.NaN, Float.NaN);
        assertTrue(Float.isNaN(seg.hullYawRateRadS()), "yaw 缺失 → yaw rate 必须 UNKNOWN(NaN)，不得当 0");
        assertEquals(0f, seg.verticalSpeedMps(), 1e-6f);
    }

    @Test
    void legacyConstructorPreservesStationaryMovementState() {
        final MovementSegment seg = new MovementSegment(
                10f, 12f, MovementType.STATIONARY,
                new Vector3(0f, 0f, 0f), new Vector3(0f, 0f, 0f),
                0f, 0f, DecodeConfidence.EXACT);

        assertEquals(MovementState.STATIONARY, seg.movementState());
    }
}
