package com.wotb.core.stats;

import com.wotb.core.model.Agg;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 跨场次按账号ID汇总每位选手 (对应 Python aggregate_players)。 */
public final class Aggregator {

    private Aggregator() {
    }

    public static Map<Long, Agg> aggregate(final List<Battle> battles, final Tankopedia tp) {
        final Map<Long, Agg> map = new LinkedHashMap<>();
        for (Battle b : battles) {
            final Integer winner = b.winnerTeam;
            final long start = b.startTime == null ? 0 : b.startTime;
            for (PlayerResult p : b.players) {
                final Agg a = map.computeIfAbsent(p.accountId, k -> {
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
                a.survivalSum += p.survivalTimeSec;
                a.kills += p.kills;
                a.damage += p.damageDealt;
                a.assisted += p.damageAssisted;
                a.received += p.damageReceived;
                a.blocked += p.damageBlocked;
                a.shots += p.nShots;
                a.hits += p.nHitsDealt;
                a.pens += p.nPenetrationsDealt;
                a.enemiesDamaged += p.nEnemiesDamaged;
                if (p.rating != null) {
                    a.ratingSum += p.rating;
                }
                final String tn = tp.info(p.tankId).name();
                a.tanks.merge(tn, 1, Integer::sum);
            }
        }
        return map;
    }
}
