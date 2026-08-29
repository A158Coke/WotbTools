package com.wotb.core.replay.event;

import com.wotb.core.replay.reconstruction.Vector3;

/**
 * 弹丸终末/爆炸解析事件（Avatar-targeted method27，34-byte args）。
 *
 * <p>当前 11.19 corpus（docs/research/replay/projectile-lifecycle.md）：
 * args = {@code shotId(u32) + field4_7Raw(u32) + materialLike(u8) +
 * terminalPoint(VECTOR3) + vectorLikeRaw(VECTOR3) + flagLikeRaw(u8)}；
 * 518/518 method27 shotId 与 method20 配对、terminalPoint == method20 endpoint。
 * 尾部 vector 不是 unit surface normal（norm 范围 ~0.18..218.6），保留 raw。</p>
 *
 * @param sequence       事件顺序号
 * @param timestamp      时间戳
 * @param packetType     来源原始 packet type（=8）
 * @param confidence     解码置信度（行为族 PROVEN / 精确字段 PARTIAL）
 * @param shotId         弹丸/射击 ID
 * @param field47Raw     原始 u32（语义 PARTIAL）
 * @param materialLike   材质类原始字节（语义 PARTIAL）
 * @param terminalPoint  终末点（== method20 endpoint）
 * @param vectorLikeRaw  尾部原始向量（非 surface normal，保留 raw）
 * @param flagLikeRaw    尾部原始字节（语义 PARTIAL）
 */
public record ProjectileResolutionEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int shotId,
        int field47Raw,
        int materialLike,
        Vector3 terminalPoint,
        Vector3 vectorLikeRaw,
        int flagLikeRaw
) implements ReplayEvent {
}
