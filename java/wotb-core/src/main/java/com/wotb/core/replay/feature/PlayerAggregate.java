package com.wotb.core.replay.feature;

/** 录像者多场聚合统计。 */
public record PlayerAggregate(
        double avgDamage,
        double avgSurvivalTime,
        double winRate
) {}
