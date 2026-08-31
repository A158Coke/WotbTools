package com.wotb.core.stats;

import com.wotb.core.model.Agg;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;
import com.wotb.core.util.PlayerResultFormat;
import org.springframework.util.StringUtils;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 跨场次按账号ID汇总每位选手 (对应 Python aggregate_players)。 */
public final class Aggregator {

    private Aggregator() {
    }

    public static Map<Long, Agg> aggregate(final List<Battle> battles, final Tankopedia tp) {
        final Map<Long, Agg> map = new LinkedHashMap<>();
        for (final Battle b : battles) {
            final Integer winner = b.winnerTeam;
            final long start = b.startTime == null ? 0 : b.startTime;
            for (final PlayerResult p : b.players) {
                final Agg a = map.computeIfAbsent(p.accountId, k -> {
                    final Agg x = new Agg();
                    x.accountId = k;
                    return x;
                });
                if (start >= a.lastTime) {   // 用最近一场的昵称/战队/队伍
                    a.lastTime = start;
                    a.nickname = StringUtils.hasText(p.nickname)
                            ? p.nickname : String.valueOf(p.accountId);
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
                final double survivalSec = canonicalSurvivalSec(b, p);
                if (survivalSec > 0) {
                    a.survivalSum += survivalSec;
                    a.survivalKnownBattles++;
                }
                a.kills += p.kills;
                a.damage += p.damageDealt;
                a.assisted += p.damageAssisted;
                a.received += p.damageReceived;
                a.blocked += p.damageBlocked;
                a.shots += p.nShots;
                a.hits += p.nHitsDealt;
                a.pens += p.nPenetrationsDealt;
                a.enemiesDamaged += p.nEnemiesDamaged;
                a.earned += p.victoryPointsEarned;
                final String tn = tp.info(p.tankId).name();
                a.tanks.merge(tn, 1, Integer::sum);
            }
        }
        return map;
    }

    /**
     * 存活玩家的 survival time 来自该场 battle duration；阵亡玩家统一走 canonical death source。
     * 任一来源不可证明时返回 0 表示 UNKNOWN，但调用方不会把它加入 survivalSum。
     */
    private static double canonicalSurvivalSec(final Battle battle, final PlayerResult player) {
        if (player.survived) {
            return battle != null && battle.durationS != null && battle.durationS > 0
                    ? battle.durationS
                    : 0;
        }
        return PlayerResultFormat.deathSec(battle, player);
    }
}
