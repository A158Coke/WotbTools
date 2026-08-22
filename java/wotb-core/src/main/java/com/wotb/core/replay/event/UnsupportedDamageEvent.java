package com.wotb.core.replay.event;

/**
 * 结构合法但语义未解码的伤害方法变体证据事件（Type-8 subtype 8，非 direct 伤害变体）。
 *
 * <p>真实回放中存在伤害方法字段（body[13]）非 {@code 3}（direct）的变体——可能对应火灾/撞击/
 * 其他尚未解码的伤害方式。这类包<b>结构合法</b>（足以读取攻击者/受击者 eid）但<b>语义未解码</b>：
 * 不产出精确伤害数字（无 damage 字段），只保留可证明的身份/时间证据，供 killer attribution
 * fail-closed 使用——致死窗口内只要存在无法排除的 unsupported 变体，击杀者必须为 null。</p>
 *
 * @param sequence         事件顺序号
 * @param timestamp        时间戳
 * @param packetType       来源原始 packet type（恒 8）
 * @param confidence       解码置信度（PARTIAL：结构部分可解析）
 * @param attackerEid      攻击者实体 ID（结构可解析时；否则 0）
 * @param victimEid        受击者实体 ID（结构可解析时；否则 0）
 * @param attackerAccountId 攻击者账号 ID（映射后填充；仅能可靠解析时非 null）
 * @param victimAccountId   受击者账号 ID（映射后填充；仅能可靠解析时非 null）
 * @param variant           未解码变体的 provenance 标识（如 {@code DAMAGE_METHOD_VARIANT}）
 */
public record UnsupportedDamageEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int attackerEid,
        int victimEid,
        Long attackerAccountId,
        Long victimAccountId,
        String variant
) implements ReplayEvent {
}
