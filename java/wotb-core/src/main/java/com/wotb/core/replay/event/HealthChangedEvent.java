package com.wotb.core.replay.event;

/**
 * 实体血量变化事件（对应 Packet Type 7 EntityProperty 的血量相关属性）。
 *
 * @param sequence       事件顺序号
 * @param timestamp      时间戳
 * @param packetType     来源原始 packet type
 * @param confidence     解码置信度
 * @param entityId       实体 ID
 * @param currentHealth  当前血量；null 表示未知
 * @param maxHealth      最大血量；null 表示未知
 * @param alive          存活状态；true=存活, false=阵亡, null=未知
 */
public record HealthChangedEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int entityId,
        Integer currentHealth,
        Integer maxHealth,
        Boolean alive
) implements ReplayEvent {
}
