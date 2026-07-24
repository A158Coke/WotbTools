package com.wotb.core.replay.event;

/**
 * 实体移除事件（对应 Packet Type 4 EntityLeave）。
 * <p>
 * EntityLeave 不一定代表阵亡，只能表示实体离开或停止存在。
 * 如果后续再次出现位置，允许更新 observation 状态。
 * 不得直接将所有 Type 4 设置为 alive=false。
 * </p>
 *
 * @param sequence    事件顺序号
 * @param timestamp   时间戳
 * @param packetType  来源原始 packet type
 * @param confidence  解码置信度
 * @param entityId    被移除的实体 ID
 */
public record EntityRemovedEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int entityId
) implements ReplayEvent {
}
