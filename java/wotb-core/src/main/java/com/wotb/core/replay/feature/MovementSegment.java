package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.reconstruction.Vector3;

public record MovementSegment(
        float startTime,
        float endTime,
        MovementType type,
        Vector3 rawStartPosition,
        Vector3 rawEndPosition,
        float distance,
        float averageSpeed,
        DecodeConfidence confidence,
        float averageSpeedKmh,
        MovementState movementState,
        float verticalDeltaMeters,
        float verticalSpeedMps,
        float hullYawRateRadS
) {
    public MovementSegment {
        if (!Float.isFinite(startTime) || !Float.isFinite(endTime)) {
            throw new IllegalArgumentException(
                    "startTime/endTime must be finite: " + startTime + "," + endTime);
        }
        if (startTime < 0f || endTime < 0f) {
            throw new IllegalArgumentException(
                    "startTime/endTime must be >= 0: " + startTime + "," + endTime);
        }
        if (startTime > endTime) {
            throw new IllegalArgumentException(
                    "startTime > endTime: " + startTime + " > " + endTime);
        }
        if (!Float.isFinite(distance) || distance < 0f) {
            throw new IllegalArgumentException("distance must be finite and >= 0: " + distance);
        }
        if (!Float.isFinite(averageSpeed) || averageSpeed < 0f) {
            throw new IllegalArgumentException(
                    "averageSpeed must be finite and >= 0: " + averageSpeed);
        }
        if (type == null) {
            throw new IllegalArgumentException("type must not be null");
        }
        if (rawStartPosition == null || rawEndPosition == null) {
            throw new IllegalArgumentException("start/end position must not be null");
        }
        if (confidence == null) {
            confidence = DecodeConfidence.UNKNOWN;
        }
        if (movementState == null) {
            movementState = MovementState.MOVING;
        }
        if (!Float.isFinite(averageSpeedKmh) || averageSpeedKmh < 0f) {
            throw new IllegalArgumentException(
                    "averageSpeedKmh must be finite and >= 0: " + averageSpeedKmh);
        }
        if (!Float.isNaN(verticalDeltaMeters) && !Float.isFinite(verticalDeltaMeters)) {
            throw new IllegalArgumentException(
                    "verticalDeltaMeters must be finite or NaN: " + verticalDeltaMeters);
        }
        if (!Float.isNaN(verticalSpeedMps) && !Float.isFinite(verticalSpeedMps)) {
            throw new IllegalArgumentException(
                    "verticalSpeedMps must be finite or NaN: " + verticalSpeedMps);
        }
        if (!Float.isNaN(hullYawRateRadS) && !Float.isFinite(hullYawRateRadS)) {
            throw new IllegalArgumentException(
                    "hullYawRateRadS must be finite or NaN: " + hullYawRateRadS);
        }
    }

    public MovementSegment(
            float startTime,
            float endTime,
            MovementType type,
            Vector3 rawStartPosition,
            Vector3 rawEndPosition,
            float distance,
            float averageSpeed,
            DecodeConfidence confidence
    ) {
        this(startTime, endTime, type, rawStartPosition, rawEndPosition,
                distance, averageSpeed, confidence,
                (float) Type10MovementMath.speedKmh(averageSpeed),
                MovementType.STATIONARY.equals(type)
                        ? MovementState.STATIONARY : MovementState.MOVING,
                Float.NaN, Float.NaN, Float.NaN);
    }

    /**
     * 带派生事实的完整构造。
     *
     * @param startYawRad 起点车体 yaw（弧度；NaN = 未知）
     * @param endYawRad   终点车体 yaw（弧度；NaN = 未知）
     */
    public static MovementSegment derived(
            final float startTime,
            final float endTime,
            final MovementType type,
            final Vector3 rawStartPosition,
            final Vector3 rawEndPosition,
            final float distance,
            final float averageSpeedMps,
            final DecodeConfidence confidence,
            final float startYawRad,
            final float endYawRad
    ) {
        final float dt = endTime - startTime;
        final float dx = rawEndPosition.x() - rawStartPosition.x();
        final float dy = rawEndPosition.y() - rawStartPosition.y();
        final float dz = rawEndPosition.z() - rawStartPosition.z();
        final boolean yawAvailable = Float.isFinite(startYawRad) && Float.isFinite(endYawRad);
        final float signedSpeed = yawAvailable && dt > 0f
                ? (float) Type10MovementMath.signedForwardSpeedMps(
                        dx, dz, dt, startYawRad) : Float.NaN;
        final float yawRate = yawAvailable && dt > 0f
                ? (float) Type10MovementMath.hullYawRateRadS(startYawRad, endYawRad, dt)
                : Float.NaN;
        final MovementState state = movementStateOf(type, averageSpeedMps,
                signedSpeed, yawRate);
        final float verticalSpeed = dt > 0f ? dy / dt : Float.NaN;
        return new MovementSegment(startTime, endTime, type,
                rawStartPosition, rawEndPosition, distance, averageSpeedMps, confidence,
                (float) Type10MovementMath.speedKmh(averageSpeedMps),
                state, dy, verticalSpeed, yawRate);
    }

    static MovementState movementStateOf(
            final MovementType type,
            final float averageSpeedMps,
            final float signedSpeedMps,
            final float yawRateRadS) {
        if (type == MovementType.STATIONARY
                || (Float.isFinite(averageSpeedMps) && averageSpeedMps < 0.1f)) {
            if (Float.isFinite(yawRateRadS) && Math.abs(yawRateRadS) >= 0.05f) {
                return MovementState.TURNING;
            }
            return MovementState.STATIONARY;
        }
        if (Float.isFinite(signedSpeedMps) && Math.abs(signedSpeedMps) >= 1.0f) {
            return signedSpeedMps > 0f ? MovementState.FORWARD : MovementState.REVERSE;
        }
        if (Float.isFinite(yawRateRadS) && Math.abs(yawRateRadS) >= 0.05f) {
            return MovementState.TURNING;
        }
        return MovementState.MOVING;
    }
}
