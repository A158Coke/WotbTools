package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.reconstruction.Vector3;

/**
 * 移动段 —— 将高频位置流压缩为战术移动段。
 *
 * @param startTime     段起始时间
 * @param endTime       段结束时间
 * @param type          移动类型
 * @param startPosition 起始坐标
 * @param endPosition   结束坐标
 * @param distance      移动距离（米）
 * @param averageSpeed  平均速度（米/秒）
 * @param confidence    分析置信度
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

    public enum MovementType {
        MOVING,
        STATIONARY,
        UNKNOWN
    }
}
