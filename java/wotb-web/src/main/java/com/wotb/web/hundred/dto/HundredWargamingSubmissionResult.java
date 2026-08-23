package com.wotb.web.hundred.dto;

/** WG 自动认证结果；verified* 均来自官方 totals，claimed 值不参与决策。 */
public record HundredWargamingSubmissionResult(
        Long id,
        String status,
        String decision,
        int verifiedAverageDamage,
        long verifiedBattleCount
) {
}
