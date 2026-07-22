package com.wotb.core.replay.event;

/**
 * 实体位置更新事件（对应 Packet Type 10）。
 *
 * @param sequence    事件顺序号
 * @param timestamp   时间戳
 * @param entityId    实体 ID
 * @param spaceId     空间 ID
 * @param vehicleId   车辆 ID
 * @param x           X 坐标
 * @param y           Y 坐标
 * @param z           Z 坐标
 * @param positionErrorX 位置误差 X
 * @param positionErrorY 位置误差 Y
 * @param positionErrorZ 位置误差 Z
 * @param yaw         偏航角
 * @param pitch       俯仰角
 * @param roll        翻滚角
 * @param errorFlag   错误标志
 * @param confidence  置信度（浮点数值验证后返回 EXACT 或有问题的返回 PARTIAL）
 */
public record PositionChangedEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int entityId,
        int spaceId,
        int vehicleId,
        float x,
        float y,
        float z,
        float positionErrorX,
        float positionErrorY,
        float positionErrorZ,
        float yaw,
        float pitch,
        float roll,
        byte errorFlag
) implements ReplayEvent {

    public PositionChangedEvent {
        if (Float.isNaN(x) || Float.isInfinite(x)
                || Float.isNaN(y) || Float.isInfinite(y)
                || Float.isNaN(z) || Float.isInfinite(z)) {
            throw new IllegalArgumentException("Position must be finite: " + x + "," + y + "," + z);
        }
    }
}
