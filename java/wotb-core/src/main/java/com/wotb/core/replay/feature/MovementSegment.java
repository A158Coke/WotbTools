package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.reconstruction.Vector3;

/**
 * 移动段 —— 将高频位置流压缩为战术移动段。
 * <p>
 * 时间语义：{@code startTime}/{@code endTime} 为 battle-relative 秒。
 * 坐标/单位语义：{@code rawStartPosition}/{@code rawEndPosition} 是 <strong>raw replay</strong>
 * 坐标（字段名显式标注 raw，展示时经由单一 resolver 转 canonical）；{@code distance} 为
 * <strong>canonical 米</strong>，{@code averageSpeed} 为 canonical 米 / battle-relative 秒
 * （m/s），{@code averageSpeedKmh} 为 km/h。
 *
 * <p>派生事实（1 Type10 unit ≈ 1 米，docs/research/replay/
 * type10-movement-transform-closure.md）：{@code verticalDeltaMeters} /
 * {@code verticalSpeedMps} / {@code hullYawRateRadS} 由端点 raw 坐标与 yaw 派生；
 * {@code movementState} 为段级分类（FORWARD/REVERSE 由 signed longitudinal speed 判定）。</p>
 * <p>
 * 不变量：所有 float 有限；{@code startTime}/{@code endTime}/{@code distance}/{@code averageSpeed}
 * 非负；{@code startTime <= endTime}；{@code type}/{@code rawStartPosition}/{@code rawEndPosition}
 * 非空。派生 scalar 允许 {@link Float#NaN}（= 端点数据不足以派生，不得当 0）。
 */
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
        // 派生 scalar 允许 NaN（未知），但有限值必须合法
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

    /**
     * Legacy 便捷构造（无派生数据）：派生 scalar 默认 NaN/由 type+speed 推导，
     * 供旧调用方/测试保持编译兼容；生产路径应使用 {@link #derived}。
     */
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
                MovementState.STATIONARY.equals(type)
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

    /** 段级移动状态分类（保守：阈值以下不臆断前进/倒车/转弯）。 */
    static MovementState movementStateOf(
            final MovementType type,
            final float averageSpeedMps,
            final float signedSpeedMps,
            final float yawRateRadS) {
        if (type == MovementType.STATIONARY
                || (Float.isFinite(averageSpeedMps) && averageSpeedMps < 0.1f)) {
            if (Float.isFinite(yawRateRadS) && Math.abs(yawRateRadS) >= 0.05f) {
                return MovementState.TURNING; // 平面位移小但车体明显转动 = 原地转向
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
