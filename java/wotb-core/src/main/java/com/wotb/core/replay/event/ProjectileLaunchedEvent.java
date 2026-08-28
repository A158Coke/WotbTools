package com.wotb.core.replay.event;

import com.wotb.core.replay.reconstruction.Vector3;

/**
 * 弹丸/曳光发射事件（Avatar-targeted method29，37-byte args）。
 *
 * <p>当前 11.19 corpus（docs/research/replay/projectile-lifecycle.md）：
 * <pre>
 *   bytes  0..4   shooterEntityId : u32 LE
 *   bytes  4..8   shotId          : u32 LE
 *   byte   8      flag/raw        : u8
 *   bytes  9..21  launchPoint     : VECTOR3&lt;f32&gt;
 *   bytes 21..33  launchVelocity  : VECTOR3&lt;f32&gt;（PROVEN：Improved Gunpowder ×1.35 闭包）
 *   bytes 33..37  invariant/raw   : f32
 * </pre>
 * method29 是<b>全局弹丸观测流</b>，不是自动的 recorder 射击——必须用 shooter identity
 * 独立闭合后才能归因给录像者。</p>
 *
 * @param sequence        事件顺序号
 * @param timestamp       时间戳
 * @param packetType      来源原始 packet type（=8）
 * @param confidence      解码置信度（结构 EXACT；flag/尾部语义 UNKNOWN）
 * @param shooterEntityId 射手实体 ID
 * @param shotId          弹丸/射击 ID
 * @param flagRaw         发射 flag 原始字节（语义 UNKNOWN）
 * @param launchPosition  发射/参考点（PROVEN physical family）
 * @param launchVelocity  发射速度向量（PROVEN；量级为当前回放有效弹速）
 * @param invariantRaw    尾部原始 float（语义 UNKNOWN）
 */
public record ProjectileLaunchedEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int shooterEntityId,
        int shotId,
        int flagRaw,
        Vector3 launchPosition,
        Vector3 launchVelocity,
        float invariantRaw
) implements ReplayEvent {
}
