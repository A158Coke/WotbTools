package com.wotb.core.replay.timeline;

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
