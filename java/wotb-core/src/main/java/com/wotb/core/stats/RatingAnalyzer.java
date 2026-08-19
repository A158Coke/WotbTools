package com.wotb.core.stats;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.model.TankInfo;
import com.wotb.core.ref.Tankopedia;
import org.springframework.util.StringUtils;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Locale;

/** Realtime rating leaderboard for an uploaded replay batch. */
public final class RatingAnalyzer {

    private static final double EXPECTED_BATTLE_SHARE = 1.0 / 14.0;
    private static final double POTENTIAL_WEIGHT = 0.70;
    private static final double KAST_WEIGHT = 0.15;
    private static final double IMPACT_WEIGHT = 0.25;
    private static final double AST_WEIGHT = 0.30;
    private static final double MULTI_DAMAGE_WEIGHT = 0.10;
    private static final double KILLS_WEIGHT = 0.10;
    private static final double DEFAULT_AVERAGE_HP = 2400.0;

    public static final class Row {
        public long accountId;
        public String nickname = "";
        public String clan = "";
        public int battles;
        public int wins;
        public long kills;
        public long damage;
        public long assistDamage;
        public long potentialDamage;
        public long potentialDamageSupplement;
        public int rating;
        public double kast;
        public double contribution;
        public double impactValue;
        public String impact = "0.00%";
        public double damageAvg;
        public double assistAvg;
        public double potentialDamageAvg;
        public double potentialDamageSupplementAvg;
        public double killsAvg;
        public double averageHp;
        public double multiDamageRate;
        double kastSum;
        double roundContribution;
        double teamRoundContribution;
        double impactSum;
        double averageHpSum;
        long lastTime = Long.MIN_VALUE;
        int impactBattles;
        int multiDamageBattles;
        int survivalBattles;
        int tradedDeaths;

        public double winRate() {
            return battles == 0 ? 0 : 100.0 * wins / battles;
        }

        void finish() {
            if (battles == 0) {
                return;
            }
            damageAvg = (double) damage / battles;
            assistAvg = (double) assistDamage / battles;
            potentialDamageAvg = (double) potentialDamage / battles;
            potentialDamageSupplementAvg = (double) potentialDamageSupplement / battles;
            killsAvg = (double) kills / battles;
            averageHp = averageHpSum / battles;
            kast = cap(100.0 * kastSum / battles, 100.0);
            contribution = teamRoundContribution == 0
                    ? 0 : 100.0 * roundContribution / teamRoundContribution;
            impactValue = impactBattles == 0 ? 0 : impactSum / impactBattles;
            impact = percent(impactValue);
            multiDamageRate = 100.0 * multiDamageBattles / battles;
            rating = finalRating();
        }

        private int finalRating() {
            final double hp = averageHp > 0 ? averageHp : 1;
            final double potentialIndex = cap(100.0 * potentialDamageAvg / hp, 250.0);
            final double astIndex = cap(100.0 * assistAvg / hp, 200.0);
            final double impactIndex = cap(impactValue, 250.0);
            final double killIndex = cap(100.0 * killsAvg, 250.0);
            final double weighted = POTENTIAL_WEIGHT * potentialIndex
                    + KAST_WEIGHT * cap(kast, 250.0)
                    + IMPACT_WEIGHT * impactIndex
                    + AST_WEIGHT * astIndex
                    + MULTI_DAMAGE_WEIGHT * multiDamageRate
                    + KILLS_WEIGHT * killIndex;
            return (int) Math.round(weighted * 10.0);
        }
    }

    private RatingAnalyzer() {
    }

    public static List<Row> compute(final List<Battle> battles, final Tankopedia tp) {
        PotentialDamage.apply(battles, tp);
        final Map<Long, Row> rows = new LinkedHashMap<>();
        for (final Battle battle : battles) {
            final BattleContext ctx = BattleContext.of(battle, tp);
            for (final PlayerResult player : battle.players) {
                final Row row = rows.computeIfAbsent(player.accountId, key -> {
                    final Row r = new Row();
                    r.accountId = key;
                    return r;
                });
                applyPlayer(row, battle, player, ctx);
            }
        }

        final List<Row> out = new ArrayList<>(rows.values());
        for (final Row row : out) {
            row.finish();
        }
        out.sort((a, b) -> Integer.compare(b.rating, a.rating));
        return out;
    }

    private static void applyPlayer(final Row row, final Battle battle, final PlayerResult player,
                                    final BattleContext ctx) {
        final long start = battle.startTime == null ? 0 : battle.startTime;
        if (start >= row.lastTime) {
            row.lastTime = start;
            row.nickname = StringUtils.hasText(player.nickname)
                    ? player.nickname : String.valueOf(player.accountId);
            row.clan = player.clan == null ? "" : player.clan;
        }

        final int team = safeTeam(player.team);
        final Integer winner = battle.winnerTeam;
        final boolean win = winner != null && winner != 0 && player.team == winner;
        final double averageHp = ctx.enemyAverageHp(player.team);
        final double contributionValue = roundContribution(player, averageHp);
        final double teamContribution = ctx.teamContribution[team];
        final double traded = tradedDeath(player, battle.players);
        final double kastBattle = singleBattleKast(player, win, traded, averageHp);
        final double impactValue = singleBattleImpact(player, ctx);

        row.battles++;
        if (win) {
            row.wins++;
        }
        row.kills += player.kills;
        row.damage += player.damageDealt;
        row.assistDamage += player.damageAssisted;
        row.potentialDamage += player.potentialDamage;
        row.potentialDamageSupplement += player.potentialDamageSupplement;
        row.roundContribution += contributionValue;
        row.teamRoundContribution += teamContribution;
        row.impactSum += impactValue;
        row.impactBattles++;
        row.averageHpSum += averageHp;
        row.kastSum += kastBattle;
        if (player.survived) {
            row.survivalBattles++;
        }
        if (!player.survived && traded > 0) {
            row.tradedDeaths++;
        }
        if (isMultiDamage(player, averageHp)) {
            row.multiDamageBattles++;
        }
    }

    private static double singleBattleImpact(final PlayerResult player, final BattleContext ctx) {
        final double battleDamageAssist = ctx.battleDamageAssist;
        final double damageAssistShare = battleDamageAssist == 0
                ? 0 : (player.damageDealt + player.damageAssisted) / battleDamageAssist;
        final double damageAssistIndex = damageAssistShare / EXPECTED_BATTLE_SHARE;
        return 100.0 * (0.75 * damageAssistIndex + 0.25 * player.kills);
    }

    private static double singleBattleKast(final PlayerResult player, final boolean win,
                                           final double traded, final double averageHp) {
        final double damageScore = ratio(player.damageDealt, averageHp * 1.15);
        final double assistScore = ratio(player.damageAssisted, averageHp * 1.25);
        final double survivalScore = player.survived && win ? 1.0 : 0.0;
        final double tradeScore = traded > 0 ? 1.0 : 0.0;
        final double combinedScore = ratio(player.damageDealt + player.damageAssisted, averageHp * 1.20);
        final double kastScore = Math.max(
                Math.max(damageScore, assistScore),
                Math.max(Math.max(survivalScore, tradeScore), combinedScore)
        );
        return cap(kastScore, 1.0);
    }

    private static boolean isMultiDamage(final PlayerResult player, final double averageHp) {
        return player.damageDealt >= averageHp * 1.5
                || (player.damageDealt >= averageHp * 1.2 && player.kills >= 1)
                || (player.damageDealt >= averageHp && player.kills >= 2)
                || player.kills >= 3;
    }

    private static double roundContribution(final PlayerResult player, final double averageHp) {
        return player.damageDealt + player.damageAssisted + player.kills * averageHp / 7.0;
    }

    private static double tradedDeath(final PlayerResult player, final List<PlayerResult> players) {
        if (player.survived || player.survivalTimeSec <= 0) {
            return 0;
        }
        int enemyDeaths = 0;
        final double from = player.survivalTimeSec - 5.0;
        final double to = player.survivalTimeSec + 5.0;
        for (final PlayerResult other : players) {
            if (other.team == player.team || other.survived || other.survivalTimeSec <= 0) {
                continue;
            }
            if (other.survivalTimeSec >= from && other.survivalTimeSec <= to) {
                enemyDeaths++;
            }
        }
        return Math.max(0, enemyDeaths);
    }

    private static double estimatedHp(final PlayerResult player, final Tankopedia tp) {
        final TankInfo info = tp.info(player.tankId);
        if (info.maxHp() != null && info.maxHp() > 0) {
            return info.maxHp();
        }
        return DEFAULT_AVERAGE_HP;
    }

    private static double ratio(final double numerator, final double denominator) {
        if (Double.isNaN(numerator) || Double.isInfinite(numerator) || numerator <= 0
                || Double.isNaN(denominator) || Double.isInfinite(denominator) || denominator <= 0) {
            return 0;
        }
        return numerator / denominator;
    }

    private static String percent(final double value) {
        if (Double.isNaN(value) || Double.isInfinite(value) || value <= 0) {
            return "0.00%";
        }
        return String.format(Locale.ROOT, "%.2f%%", value);
    }

    private static double cap(final double value, final double max) {
        if (Double.isNaN(value) || Double.isInfinite(value) || value <= 0) {
            return 0;
        }
        return Math.min(max, value);
    }

    private static int safeTeam(final int team) {
        return (team == 1 || team == 2) ? team : 0;
    }

    private static final class BattleContext {
        final double[] teamAverageHp = new double[3];
        final double[] teamContribution = new double[3];
        double battleDamageAssist;

        static BattleContext of(final Battle battle, final Tankopedia tp) {
            final BattleContext ctx = new BattleContext();
            final double[] hpSum = new double[3];
            final int[] hpCount = new int[3];
            for (final PlayerResult player : battle.players) {
                final int team = safeTeam(player.team);
                final double hp = estimatedHp(player, tp);
                hpSum[team] += hp;
                hpCount[team]++;
                ctx.battleDamageAssist += player.damageDealt + player.damageAssisted;
            }
            for (int team = 0; team < ctx.teamAverageHp.length; team++) {
                ctx.teamAverageHp[team] = hpCount[team] == 0 ? DEFAULT_AVERAGE_HP : hpSum[team] / hpCount[team];
            }
            for (final PlayerResult player : battle.players) {
                final int team = safeTeam(player.team);
                final double averageHp = ctx.enemyAverageHp(player.team);
                ctx.teamContribution[team] += roundContribution(player, averageHp);
            }
            return ctx;
        }

        double enemyAverageHp(final int team) {
            if (team == 1) {
                return positive(teamAverageHp[2], teamAverageHp[1]);
            }
            if (team == 2) {
                return positive(teamAverageHp[1], teamAverageHp[2]);
            }
            return positive(teamAverageHp[0], DEFAULT_AVERAGE_HP);
        }

        private static double positive(final double preferred, final double fallback) {
            if (preferred > 0) {
                return preferred;
            }
            return fallback > 0 ? fallback : DEFAULT_AVERAGE_HP;
        }
    }
}
