package com.wotb.core.replay.event;

/**
 * 伤害事件（对应 Packet Type 8 EntityMethod 的 direct HP damage）。
 *
 * @param sequence     事件顺序号
 * @param timestamp    时间戳
 * @param packetType   来源原始 packet type
 * @param confidence   解码置信度
 * @param attackerEid  攻击者实体 ID
 * @param victimEid    受击者实体 ID
 * @param attackerAccountId 攻击者账号 ID（映射后填充）
 * @param victimAccountId   受击者账号 ID（映射后填充）
 * @param damage       伤害值
 * @param lethal       是否可能是致命伤害（累积伤害到达阈值）
 */
public record DamageEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int attackerEid,
        int victimEid,
        Long attackerAccountId,
        Long victimAccountId,
        int damage,
        boolean lethal
) implements ReplayEvent {
}
