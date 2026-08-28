package com.wotb.core.replay.event;

/**
 * 车辆开火观测事件（Vehicle-targeted method0，1-byte args = 01）。
 *
 * <p>当前 11.19 corpus（docs/research/replay/vehicle-firing.md）：
 * method0 = observed vehicle firing / showShooting-family 信号（4,154/4,154 args=01）。
 * 观测缺失可能（敌方在 AoI 外/流不完整），但从不虚增：count &lt;= settlement shots。</p>
 *
 * @param sequence   事件顺序号
 * @param timestamp  时间戳
 * @param packetType 来源原始 packet type（=8）
 * @param confidence 解码置信度
 * @param entityId   开火车辆实体 ID
 * @param argRaw     原始 args（当前恒 {01}；其它值域未观测，保留 raw）
 */
public record VehicleFiredEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int entityId,
        int argRaw
) implements ReplayEvent {
}
