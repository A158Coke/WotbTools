package com.wotb.core.replay.event;

/**
 * 实体创建事件（对应 Packet Type 0/1/2）。
 *
 * @param sequence      事件顺序号
 * @param timestamp     时间戳
 * @param packetType    来源原始 packet type
 * @param confidence    解码置信度
 * @param entityId      实体 ID
 * @param unknownInitData 无法解析的初始化数据（格式待研究）
 */
public record EntityCreatedEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int entityId,
        byte[] unknownInitData
) implements ReplayEvent {
}
