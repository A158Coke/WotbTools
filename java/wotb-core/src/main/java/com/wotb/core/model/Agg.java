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
    public long kills, damage, assisted, received, blocked;
    public long earned;   // 争霸赛获取点数累计（客观事实，不参与 Rating）
    public long shots, hits, pens, enemiesDamaged;
    public double survivalSum;        // 仅 canonical 已知场次的存活/阵亡时长之和（秒）
    public int survivalKnownBattles;  // survival time 可证明的场次数；UNKNOWN 不得按 0 秒进入平均
    public final Map<String, Integer> tanks = new TreeMap<>();

    public double winRate() {
        return battles == 0 ? 0 : 100.0 * wins / battles;
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

    /**
     * 跨场平均生存时长。只有全部选中场次都有 canonical survival/death time 时才可计算；
     * 任一阵亡时刻 UNKNOWN 则返回 null，避免 UNKNOWN 被 0 秒稀释到平均值里。
     */
    public Double survivalAvg() {
        return battles > 0 && survivalKnownBattles == battles
                ? survivalSum / battles
                : null;
    }

    /** 命中率 = hits/shots（0-100）；shots == 0 → null（unavailable，禁止 0/0 伪装 0%）。 */
    public Double hitRate() {
        return shots == 0 ? null : 100.0 * hits / shots;
    }

    /** 击穿率 = pens/hits（0-100，分母是命中次数不是射击次数）；hits == 0 → null。 */
    public Double penRate() {
        return hits == 0 ? null : 100.0 * pens / hits;
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
