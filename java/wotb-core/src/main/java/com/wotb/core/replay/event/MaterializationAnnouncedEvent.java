package com.wotb.core.replay.event;

/**
 * 实体预物化 / 进入观测集公告事件（对应 Packet Type 33）。
 *
 * <p>当前 11.19 corpus（docs/research/replay/entity-materialization.md）：
 * Type33 总在 Type5 之前（min ~0.046s / median ~0.400s / max ~1.207s），
 * 载荷 = {@code entityId(u32 LE) + zeroTail(8 字节，当前 corpus 全零)}。</p>
 *
 * <p>Type33 是「进入观测集/预物化」阶段，不等于 spotted 全局标记，也不等于死亡；
 * 对敌方 combat vehicle 它构成 AoI re-entry 边界的一部分（Type33 → Type5 → Type10 流）。</p>
 *
 * @param sequence   事件顺序号
 * @param timestamp  时间戳
 * @param packetType 来源原始 packet type（=33）
 * @param confidence 解码置信度
 * @param entityId   实体 ID
 * @param zeroTail   Type33 尾部原始字节（当前 corpus 8 字节全零；语义未证明，保留 raw）
 */
public record MaterializationAnnouncedEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int entityId,
        byte[] zeroTail
) implements ReplayEvent {
}
