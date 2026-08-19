package com.wotb.core.model;

import java.util.Map;
import java.util.TreeMap;

/** 一位选手的跨场累计 (由 Aggregator 聚合产生)。 */
public final class Agg {
    public long accountId;
    public String nickname = "";
    public String clan = "";
    public int team;                  // 最近一场的队伍(供 UI 行底色)
    public long lastTime = -1;
    public int battles, wins, survived;
    public long kills, damage, potentialDamage, potentialDamageSupplement, assisted, received, blocked;
    public long shots, hits, pens, enemiesDamaged;
    public double survivalSum;        // 各场存活时间(秒)之和(用于场均)
    public long ratingSum;            // 各场 rating 之和(用于场均)
    public final Map<String, Integer> tanks = new TreeMap<>();

    public double winRate() {
        return battles == 0 ? 0 : 100.0 * wins / battles;
    }

    public double avgRating() {
        return battles == 0 ? 0 : (double) ratingSum / battles;
    }

    public double survivalRate() {
        return battles == 0 ? 0 : 100.0 * survived / battles;
    }

    public double avg(final long total) {
        return battles == 0 ? 0 : (double) total / battles;
    }

    public double avg(final double total) {
        return battles == 0 ? 0 : total / battles;
    }

    public double hitRate() {
        return shots == 0 ? 0 : 100.0 * hits / shots;
    }

    public double penRate() {
        return shots == 0 ? 0 : 100.0 * pens / shots;
    }

    public String tanksStr() {
        final StringBuilder sb = new StringBuilder();
        tanks.entrySet().stream()
                .sorted((a, b) -> b.getValue() - a.getValue())
                .forEach(e -> {
                    if (!sb.isEmpty()) sb.append(", ");
                    sb.append(e.getValue() > 1 ? e.getKey() + "×" + e.getValue() : e.getKey());
                });
        return sb.toString();
    }
}