package com.wotb.core.replay.event;

/**
 * 录像者弹药库存/状态事件（Avatar-targeted method17，12-byte args）。
 *
 * <p>当前 11.19 corpus（docs/research/replay/avatar-method17-ammunition-state.md）：
 * 正常开火变体 = {@code shellDescriptor(u32 LE) + args[4]=0 + remainingQuantity(u8) +
 * 6 字节零}；每发 recorder 弹丸发射同刻都有 method17，quantity 精确递减。
 * 初始化变体尾部含非零字节（clip/feed 状态），不得强制套用 remainingQuantity。</p>
 *
 * @param sequence            事件顺序号
 * @param timestamp           时间戳
 * @param packetType          来源原始 packet type（=8）
 * @param confidence          解码置信度（descriptor 与 quantity 仅正常开火变体 PROVEN）
 * @param entityId            方法调用目标（recorder Avatar entity）
 * @param itemDescriptorRaw   弹药/物品 descriptor（u32 LE；不是 entity ID）
 * @param flagRaw             args[4]（正常开火变体 = 0）
 * @param remainingQuantity   args[5]（正常开火变体 = 剩余数量；初始化变体语义未闭合，保留 raw）
 * @param variantRaw          尾部 8 字节原始（初始化/feed 状态，PARTIAL）
 */
public record AmmunitionStateEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int entityId,
        int itemDescriptorRaw,
        int flagRaw,
        int remainingQuantity,
        byte[] variantRaw
) implements ReplayEvent {
}
