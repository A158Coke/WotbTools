package com.wotb.core.replay.event;

import com.wotb.core.replay.reconstruction.Vector3;

/**
 * 弹丸终点事件（Avatar-targeted method20 stopTracer，28-byte args）。
 *
 * <p>当前 11.19 corpus（docs/research/replay/projectile-lifecycle.md）：
 * args = {@code shotId(u32 LE) + endPoint(VECTOR3&lt;f32&gt;)}；
 * 4,161/4,161 method29 shotId 都有 method20 配对。stopTracer ≠ 穿透/伤害。</p>
 *
 * @param sequence         事件顺序号
 * @param timestamp        时间戳
 * @param packetType       来源原始 packet type（=8）
 * @param confidence       解码置信度（PROVEN）
 * @param shotId           弹丸/射击 ID
 * @param terminalPosition 终点位置（PROVEN）
 */
public record ProjectileTerminalEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int shotId,
        Vector3 terminalPosition
) implements ReplayEvent {
}
