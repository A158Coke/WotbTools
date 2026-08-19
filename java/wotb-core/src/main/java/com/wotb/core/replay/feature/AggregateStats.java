package com.wotb.core.replay.feature;

/** 聚合统计。 */
public record AggregateStats(
        double avgDamage,
        double winRate,
        double avgSurvivalTime
) {}
