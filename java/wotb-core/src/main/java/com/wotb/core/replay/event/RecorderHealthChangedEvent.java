package com.wotb.core.replay.event;

/**
 * 录像者自身血量镜像事件（Avatar-targeted method5，3-byte variant）。
 *
 * <p>当前 11.19 corpus（docs/research/replay/avatar-method5-own-health.md）：
 * wire body = {@code currentHp(u16 LE) + flag(u8)}；flag 恒 1（298/298）。
 * 每个回放有一个初始化 method5 值（早于首个 recorder Type7 prop3 HP 更新），
 * 后续 method5 与同刻 prop3 完全一致（264/264）。初始化值是 opener 满血种子
 * （34/34：首个 recorder Vehicle Type5 hpRaw == method5 opening HP）。</p>
 *
 * <p>类作用域：只有 3-byte variant 属于 Avatar own-health schema；
 * 18-byte variant 属于其它实体族，不得按 u16+flag 解码。</p>
 *
 * @param sequence   事件顺序号
 * @param timestamp  时间戳
 * @param packetType 来源原始 packet type（=8）
 * @param confidence 解码置信度（结构/HP PROVEN）
 * @param entityId   方法调用目标实体（recorder Avatar entity；处理层负责核对 recorder 身份）
 * @param currentHp  当前 HP（u16 LE）
 * @param flagRaw    尾部 flag 原始字节（当前 corpus 恒 1；语义 UNKNOWN，保留 raw）
 */
public record RecorderHealthChangedEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int entityId,
        int currentHp,
        int flagRaw
) implements ReplayEvent {
}
