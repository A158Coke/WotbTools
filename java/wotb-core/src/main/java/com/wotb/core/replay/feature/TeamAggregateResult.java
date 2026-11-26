package com.wotb.core.replay.feature;

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
