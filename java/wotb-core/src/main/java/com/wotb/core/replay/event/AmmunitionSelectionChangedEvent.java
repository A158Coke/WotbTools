package com.wotb.core.replay.event;

/**
 * 录像者弹药选择状态事件（Packet Type 28）。
 *
 * <p>当前 11.19 corpus（docs/research/replay/type28-ammunition-slot.md）：
 * payload = {@code selectionValue(u32 LE)}，观测域 {0,1,2}；是 recorder-local
 * 弹药选择状态（非 target-lock/auto-aim）。选择值 → 弹种必须经 method17 descriptor
 * 或 version-matched catalog 闭合；不得全局 hardcode slot 0=AP 等。</p>
 *
 * @param sequence       事件顺序号
 * @param timestamp      时间戳
 * @param packetType     来源原始 packet type（=28）
 * @param confidence     解码置信度
 * @param selectionValue 弹药选择值（0/1/2；其它值保留 raw 并标 PARTIAL）
 */
public record AmmunitionSelectionChangedEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int selectionValue
) implements ReplayEvent {
}
