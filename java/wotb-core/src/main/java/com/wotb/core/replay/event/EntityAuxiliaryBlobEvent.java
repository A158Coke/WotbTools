package com.wotb.core.replay.event;

import java.util.Arrays;

/**
 * Type32 generic auxiliary-blob envelope event（P0-2/P0-3）。
 *
 * <p>Type32 不是 consumable-only packet（docs/research/replay/type32-entity-effects.md）：它的 full-corpus
 * 结构是长度前缀实体辅助 blob：{@code entityId(u32 LE) + flag(u8) + bodyLength(u32 LE) + body}，
 * 且 {@code bodyLength == payload.length - 9}（16,850/16,850）。本事件只保留信封结构 + raw body，
 * <b>不</b>在此把 body 解释成 consumable —— semantic routing 由 {@code ConsumableLifecycleEvent} /
 * 后续 semantic 层负责（依据 client version + entity class + flag + body length）。</p>
 *
 * <p><b>禁止</b>以此事件把整类 Type32 当 consumable，也禁止用 {@code switch(bodyLength)} 当语义路由表。</p>
 *
 * @param sequence      事件顺序号
 * @param timestamp     时间戳
 * @param packetType    原始包类型（=32）
 * @param confidence    envelope 解码置信度（framing 校验通过 → EXACT）
 * @param entityId      实体 id
 * @param flag          envelope flag（u8）
 * @param bodyLength    声明的 body 长度（u32 LE）
 * @param bodyRaw       raw body（长度=bodyLength；与 payload.length-9 严格相等）
 */
public record EntityAuxiliaryBlobEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int entityId,
        int flag,
        int bodyLength,
        byte[] bodyRaw
) implements ReplayEvent {

    public EntityAuxiliaryBlobEvent {
        bodyRaw = bodyRaw == null ? new byte[0] : Arrays.copyOf(bodyRaw, bodyRaw.length);
    }

    @Override
    public byte[] bodyRaw() {
        return Arrays.copyOf(bodyRaw, bodyRaw.length);
    }
}
