package com.wotb.core;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** 跨场次按账号ID汇总每位选手 (对应 Python aggregate_players)。 */
public final class Aggregator {

    /** 一位选手的跨场累计。 */
    public static final class Agg {
        public long accountId;
        public String nickname = "";
        public String clan = "";
        public int team;                  // 最近一场的队伍(供 UI 行底色)
        long lastTime = -1;
        public int battles, wins, survived;
        public long kills, damage, assisted, received, blocked;
        public long shots, hits, pens, hitsReceived, pensReceived, enemiesDamaged;
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

        public double avg(long total) {
            return battles == 0 ? 0 : (double) total / battles;
        }

        public double hitRate() {
            return shots == 0 ? 0 : 100.0 * hits / shots;
        }

        public double penRate() {
            return shots == 0 ? 0 : 100.0 * pens / shots;
        }

        public String tanksStr() {
            StringBuilder sb = new StringBuilder();
            tanks.entrySet().stream()
                    .sorted((a, b) -> b.getValue() - a.getValue())
                    .forEach(e -> {
                        if (sb.length() > 0) sb.append(", ");
                        sb.append(e.getValue() > 1 ? e.getKey() + "×" + e.getValue() : e.getKey());
                    });
            return sb.toString();
        }
    }

    private Aggregator() {
    }

    public static Map<Long, Agg> aggregate(List<Battle> battles, Tankopedia tp) {
        Map<Long, Agg> map = new LinkedHashMap<>();
        for (Battle b : battles) {
            Integer winner = b.winnerTeam;
            long start = b.startTime == null ? 0 : b.startTime;
            for (PlayerResult p : b.players) {
                Agg a = map.computeIfAbsent(p.accountId, k -> {
                    Agg x = new Agg();
                    x.accountId = k;
                    return x;
                });
                if (start >= a.lastTime) {   // 用最近一场的昵称/战队/队伍
                    a.lastTime = start;
                    a.nickname = (p.nickname == null || p.nickname.isEmpty())
                            ? String.valueOf(p.accountId) : p.nickname;
                    a.clan = p.clan == null ? "" : p.clan;
                    a.team = p.team;
                }
                a.battles++;
                if (winner != null && winner != 0 && p.team == winner) {
                    a.wins++;
                }
                if (p.survived) {
                    a.survived++;
                }
                a.kills += p.kills;
                a.damage += p.damageDealt;
                a.assisted += p.damageAssisted;
                a.received += p.damageReceived;
                a.blocked += p.damageBlocked;
                a.shots += p.nShots;
                a.hits += p.nHitsDealt;
                a.pens += p.nPenetrationsDealt;
                a.hitsReceived += p.nHitsReceived;
                a.pensReceived += p.nPenetrationsReceived;
                a.enemiesDamaged += p.nEnemiesDamaged;
                if (p.rating != null) {
                    a.ratingSum += p.rating;
                }
                String tn = tp.info(p.tankId).name;
                a.tanks.merge(tn, 1, Integer::sum);
            }
        }
        return map;
    }
}
