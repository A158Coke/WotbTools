package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.reconstruction.Vector3;

/**
 * 移动段 —— 将高频位置流压缩为战术移动段。
 * <p>
 * 时间语义：{@code startTime}/{@code endTime} 为 battle-relative 秒。
 * 坐标/单位语义：{@code rawStartPosition}/{@code rawEndPosition} 是 <strong>raw replay</strong>
 * 坐标（字段名显式标注 raw，展示时经由单一 resolver 转 canonical）；{@code distance} 为
 * <strong>canonical 米</strong>，{@code averageSpeed} 为 canonical 米 / battle-relative 秒。
 * <p>
 * 不变量：所有 float 有限；{@code startTime}/{@code endTime}/{@code distance}/{@code averageSpeed}
 * 非负；{@code startTime <= endTime}；{@code type}/{@code rawStartPosition}/{@code rawEndPosition}
 * 非空。
 */
public record MovementSegment(
        float startTime,
        float endTime,
        MovementType type,
        Vector3 rawStartPosition,
        Vector3 rawEndPosition,
        float distance,
        float averageSpeed,
        DecodeConfidence confidence
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
    }
}
