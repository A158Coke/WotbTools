package com.wotb.core.replay.evidence;

import java.util.List;

/**
 * 坦克战术语义层（文档 §6 Tank Tactical Profile）。
 * <p>不是 Tankopedia 原始数值的复制，而是供 LLM 使用的语义标签：
 * 例如 {@code mobility=HIGH}、{@code hullDownAbility=HIGH}。</p>
 *
 * @param vehicleClass     语义车种（HEAVY / MEDIUM / LIGHT / TANK_DESTROYER / UNKNOWN）
 * @param roles            战术角色标签
 * @param strengths        优势标签
 * @param weaknesses       劣势标签
 * @param mobility         机动性语义（HIGH / MEDIUM / LOW / UNKNOWN）
 * @param burstPotential   爆发潜力语义
 * @param sustainedDpm     持续输出语义
 * @param hullDownAbility  卖头/地形依赖能力语义
 * @param armorReliability 装甲可靠性语义
 * @param curated          是否来自人工精选条目（false = 车型级 fallback 默认值）
 */
public record TankTacticalProfile(
        String vehicleClass,
        List<String> roles,
        List<String> strengths,
        List<String> weaknesses,
        String mobility,
        String burstPotential,
        String sustainedDpm,
        String hullDownAbility,
        String armorReliability,
        boolean curated
) {
    public TankTacticalProfile {
        if (vehicleClass == null || vehicleClass.isBlank()) {
            vehicleClass = "UNKNOWN";
        }
        roles = roles == null ? List.of() : List.copyOf(roles);
        strengths = strengths == null ? List.of() : List.copyOf(strengths);
        weaknesses = weaknesses == null ? List.of() : List.copyOf(weaknesses);
        if (mobility == null || mobility.isBlank()) mobility = "UNKNOWN";
        if (burstPotential == null || burstPotential.isBlank()) burstPotential = "UNKNOWN";
        if (sustainedDpm == null || sustainedDpm.isBlank()) sustainedDpm = "UNKNOWN";
        if (hullDownAbility == null || hullDownAbility.isBlank()) hullDownAbility = "UNKNOWN";
        if (armorReliability == null || armorReliability.isBlank()) armorReliability = "UNKNOWN";
    }
}
