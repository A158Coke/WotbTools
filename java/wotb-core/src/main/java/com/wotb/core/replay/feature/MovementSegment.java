package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.reconstruction.Vector3;

/**
 * 移动段 —— 将高频位置流压缩为战术移动段。
 */
public record MovementSegment(
        float startTime,
        float endTime,
        MovementType type,
        Vector3 startPosition,
        Vector3 endPosition,
        float distance,
        float averageSpeed,
        DecodeConfidence confidence
) {
}
