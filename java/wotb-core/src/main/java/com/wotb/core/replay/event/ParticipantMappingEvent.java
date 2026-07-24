package com.wotb.core.replay.event;

/**
 * 参与者映射事件：将 entityId 映射到 accountId。
 * <p>
 * 来自 Type 8 Method 48 (updateArena2)。
 * 实体可能在映射完成之前就产生位置或属性事件，
 * 因此重建器必须支持：先观察 entityId，后收到映射，再回填实体身份。
 * </p>
 *
 * @param sequence   事件顺序号
 * @param timestamp  时间戳
 * @param packetType 来源原始 packet type
 * @param confidence 解码置信度
 * @param entityId   实体 ID
 * @param accountId  账号 ID
 */
public record ParticipantMappingEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int entityId,
        long accountId
) implements ReplayEvent {
}
