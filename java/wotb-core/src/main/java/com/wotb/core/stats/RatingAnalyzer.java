package com.wotb.core.stats;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.Tankopedia;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Realtime rating leaderboard for an uploaded replay batch. */
public final class RatingAnalyzer {

    public static final class Row {
        public long accountId;
        public String nickname = "";
        public String clan = "";
        public int battles;
        public int wins;
        public long kills;
        public long damage;
        public long potentialDamage;
        public long potentialDamageSupplement;
        public int rating;
        public double kast;
        public double contribution;
        public double influence;
        public double damageAvg;
        public double potentialDamageAvg;
        public double potentialDamageSupplementAvg;
        public double killsAvg;
        double ratingSum;
        double effectiveContribution;
        double teamEffectiveContribution;
        double killShareDenominator;
        double enemiesDamaged;
        double enemiesDamagedShareDenominator;
        long lastTime = Long.MIN_VALUE;
        int kastBattles;

        public double winRate() {
            return battles == 0 ? 0 : 100.0 * wins / battles;
        }

        void finish() {
            if (battles == 0) {
                return;
            }
            rating = (int) Math.round(ratingSum / battles);
            kast = 100.0 * kastBattles / battles;
            contribution = teamEffectiveContribution == 0
                    ? 0 : 100.0 * effectiveContribution / teamEffectiveContribution;
            damageAvg = (double) damage / battles;
            potentialDamageAvg = (double) potentialDamage / battles;
            potentialDamageSupplementAvg = (double) potentialDamageSupplement / battles;
            killsAvg = (double) kills / battles;
            final double ecShare = teamEffectiveContribution == 0 ? 0 : effectiveContribution / teamEffectiveContribution;
            final double killShare = killShareDenominator == 0 ? 0 : kills / killShareDenominator;
            final double enemyShare = enemiesDamagedShareDenominator == 0
                    ? 0 : enemiesDamaged / enemiesDamagedShareDenominator;
            final double expectedTeamShare = 1.0 / 7.0;
            influence = 100.0 * (
                    0.60 * (ecShare / expectedTeamShare)
                            + 0.25 * (killShare / expectedTeamShare)
                            + 0.15 * (enemyShare / expectedTeamShare));
        }
    }

    private RatingAnalyzer() {
    }

    public static List<Row> compute(final List<Battle> battles, final Tankopedia tp) {
        PotentialDamage.apply(battles, tp);
        Rating.compute(battles, tp);
        final Map<Long, Row> rows = new LinkedHashMap<>();
        for (final Battle battle : battles) {
            final double[] teamEc = new double[3];
            final double[] teamKills = new double[3];
            final double[] teamEnemiesDamaged = new double[3];
            for (final PlayerResult player : battle.players) {
                final int team = safeTeam(player.team);
                teamEc[team] += Rating.effectiveContribution(player);
                teamKills[team] += player.kills;
                teamEnemiesDamaged[team] += player.nEnemiesDamaged;
            }

            final Integer winner = battle.winnerTeam;
            final long start = battle.startTime == null ? 0 : battle.startTime;
            for (final PlayerResult player : battle.players) {
                final Row row = rows.computeIfAbsent(player.accountId, key -> {
                    final Row r = new Row();
                    r.accountId = key;
                    return r;
                });
                if (start >= row.lastTime) {
                    row.lastTime = start;
                    row.nickname = (player.nickname == null || player.nickname.isEmpty())
                            ? String.valueOf(player.accountId) : player.nickname;
                    row.clan = player.clan == null ? "" : player.clan;
                }
                final int team = safeTeam(player.team);
                row.battles++;
                if (winner != null && winner != 0 && player.team == winner) {
                    row.wins++;
                }
                row.kills += player.kills;
                row.damage += player.damageDealt;
                row.potentialDamage += player.potentialDamage;
                row.potentialDamageSupplement += player.potentialDamageSupplement;
                row.ratingSum += player.rating == null ? 0 : player.rating;
                row.effectiveContribution += Rating.effectiveContribution(player);
                row.teamEffectiveContribution += teamEc[team];
                row.killShareDenominator += teamKills[team];
                row.enemiesDamaged += player.nEnemiesDamaged;
                row.enemiesDamagedShareDenominator += teamEnemiesDamaged[team];
                if (player.kills > 0 || player.damageAssisted > 0 || player.survived) {
                    row.kastBattles++;
                }
            }
        }

        final List<Row> out = new ArrayList<>(rows.values());
        for (final Row row : out) {
            row.finish();
        }
        out.sort((a, b) -> Integer.compare(b.rating, a.rating));
        return out;
    }

    private static int safeTeam(final int team) {
        return (team == 1 || team == 2) ? team : 0;
    }
}