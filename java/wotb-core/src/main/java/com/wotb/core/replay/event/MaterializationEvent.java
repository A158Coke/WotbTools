package com.wotb.core.replay.event;

/**
 * 实体物化事件（对应 Packet Type 5）。
 *
 * <p>当前 11.19 corpus（docs/research/replay/entity-materialization.md、
 * actual-hp-type5-settlement.md）：Type5 = 实体物化 + 初始 transform/state 快照 +
 * 类专属初始化数据。对 {@code entityTypeId=2}（settled combat vehicle）：
 * <ul>
 *   <li>载荷 {@code [6..14)} == 随后首个 Type10 {@code [4..12)}（spaceId + attachmentParentEntityId）；</li>
 *   <li>载荷 {@code [51..53)} = 物化/重物化时的 current HP 快照（PROVEN current corpus）；</li>
 *   <li>敌方 re-entry 时该 HP 可能低于上一次消失前 method1/prop3 的 HP
 *       （在 AoI 外额外受击），因此 re-entry 必须以 Type5 快照为准，不得沿用 stale last-known HP。</li>
 * </ul>
 * Type5 不等于一次性创建（同一 combat vehicle 可多次物化），也不等于死亡。</p>
 *
 * <p>版本/类作用域：{@code entityTypeId} 与字节偏移 51 是 11.19/类作用域的；
 * 非 {@code entityTypeId=2} 或未知版本只保留 raw，不臆测 HP。置信度只描述物化 presence
 * （结构解码成功即 EXACT），与 HP 是否可解独立。</p>
 *
 * @param sequence        事件顺序号
 * @param timestamp       时间戳
 * @param packetType      来源原始 packet type（=5）
 * @param confidence      物化 presence 置信度（结构解码成功即 EXACT）；HP 为独立维度（见 currentHp）
 * @param entityId        实体 ID
 * @param entityTypeId    实体类型 ID（2 = combat vehicle；3 = static family；其它未观测）
 * @param currentHp       物化时的当前 HP 快照；null = 未解码/不可信（非 entityTypeId=2 或版本未允许）
 * @param initialTransformRaw 物化初始 transform/state 原始字节（含 [6..14) 前缀，raw 保留）
 * @param initPayloadRaw  类专属初始化数据原始字节（loadout 等，raw 保留）
 */
public record MaterializationEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int entityId,
        int entityTypeId,
        Integer currentHp,
        byte[] initialTransformRaw,
        byte[] initPayloadRaw,
        VehicleBattleLoadout loadout
) implements ReplayEvent {

    /** 兼容旧 9 参构造：loadout 未解析时为 null（仅 MaterializationDecoder 生产 semantic loadout）。 */
    public MaterializationEvent(
            int sequence,
            ReplayTimestamp timestamp,
            int packetType,
            DecodeConfidence confidence,
            int entityId,
            int entityTypeId,
            Integer currentHp,
            byte[] initialTransformRaw,
            byte[] initPayloadRaw) {
        this(sequence, timestamp, packetType, confidence, entityId, entityTypeId,
                currentHp, initialTransformRaw, initPayloadRaw, null);
    }
}
