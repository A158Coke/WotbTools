package com.wotb.core.replay.feature;

/**
 * 来自 battle_results.dat 的权威团队结算聚合。
 */
public record TeamAggregateResult(
        int memberCount,
        int totalDamageDealt,
        int totalDamageReceived,
        int totalAssistedDamage,
        int totalBlockedDamage,
        int totalKills,
        int survivorCount,
        int deathCount,
        Double averageDeathTimeSec,
        Double firstDeathTimeSec,
        Double lastDeathTimeSec,
        Boolean win
) {
}
