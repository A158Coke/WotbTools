package com.wotb.core.model;

/**
 * 攻击者对某一被击杀目标的击杀前伤害明细（killer attribution 证据链）。
 *
 * <p>由 {@code ReplayParser} 从事件流累计生成，AI 复盘 evidence 层消费
 * （{@code PlayerEvidenceFormatter} 用 victim 身份线索判断「谁杀谁」）；
 * <b>与已移除的潜在伤害（Potential Damage）指标无关</b>——指标删除后该证据链
 * 作为独立职责保留。</p>
 */
public record KillVictim(long victimAccountId, int damage, int penetrations) {
}
