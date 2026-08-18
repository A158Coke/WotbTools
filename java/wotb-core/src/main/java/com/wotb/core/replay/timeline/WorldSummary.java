package com.wotb.core.replay.timeline;

/**
 * Frame 的全局战场概览：双方存活、敌方知识分布、争霸赛实时点数（如有）。
 */
public record WorldSummary(
        int friendlyAlive,
        int enemyAlive,
        int friendlyTotal,
        int enemyTotal,
        int enemyKnown,
        int enemyLastKnown,
        int enemyUnknown,
        int enemyDestroyedKnown,
        Integer friendlyPoints,
        Integer enemyPoints
) {
    public static final WorldSummary EMPTY = new WorldSummary(0, 0, 0, 0, 0, 0, 0, 0, null, null);
}
