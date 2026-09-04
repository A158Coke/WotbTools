package com.wotb.core.league;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** 批次选手/战队 V6 汇总（只做当前上传内容的即时汇总，不排序、不产生批次奖项）。 */
public final class LeagueRatingBatchAggregator {

    private LeagueRatingBatchAggregator() {
    }

    /** 汇总一批已评分的 league 场次（battles 与 results 按下标对齐）。 */
    public static LeagueRatingBatch aggregate(final List<Battle> battles,
                                              final List<LeagueRatingResult> results,
                                              final List<LeagueFailure> failures) {
        final Map<Long, PlayerAcc> players = new LinkedHashMap<>();
        final Map<String, TeamAcc> teams = new LinkedHashMap<>();
        for (int i = 0; i < Math.min(battles.size(), results.size()); i++) {
            final Battle battle = battles.get(i);
            final LeagueRatingResult result = results.get(i);
            if (result == null || !result.rated()) {
                continue;
            }
            final Integer winner = battle.winnerTeam;
            final Map<Long, PlayerResult> playerByAccount = new HashMap<>();
            if (battle.players != null) {
                for (final PlayerResult pr : battle.players) {
                    playerByAccount.put(pr.accountId, pr);
                }
            }
            for (final PlayerLeagueRating p : result.players()) {
                final PlayerAcc acc = players.computeIfAbsent(p.accountId(), k -> new PlayerAcc());
                acc.nickname = p.nickname();
                acc.clan = p.clan();
                acc.ratedBattles++;
                LeagueBatchRatingCalculator.requireObservation(p.finalRating());
                acc.ratingSum = acc.ratingSum.add(BigDecimal.valueOf(p.finalRating()));
                if (p.dimensionScores().size() != LeagueColumns.DIM_KEYS.size()) {
                    throw new IllegalStateException("Player dimension score count must be "
                            + LeagueColumns.DIM_KEYS.size() + ", got " + p.dimensionScores().size());
                }
                for (int d = 0; d < p.dimensionScores().size(); d++) {
                    acc.dimensionSums[d] = acc.dimensionSums[d].add(BigDecimal.valueOf(p.dimensionScores().get(d)));
                }
                if (p.mvp()) {
                    acc.mvpCount++;
                }
                if (winner != null && p.team() == winner) {
                    acc.wins++;
                }
                acc.damageTotal += p.damageDealt();
                acc.assistTotal += p.damageAssisted();
                acc.killsTotal += p.kills();
                final PlayerResult pr = playerByAccount.get(p.accountId());
                if (pr != null) {
                    acc.vehicleCounts.merge(pr.tankId, 1, Integer::sum);
                }
            }
            for (final TeamLeagueRating team : new TeamLeagueRating[]{result.team1(), result.team2()}) {
                if (team == null || team.players().isEmpty()) {
                    continue;
                }
                final String key = teamKey(battle, team);
                final TeamAcc acc = teams.computeIfAbsent(key, k -> new TeamAcc());
                acc.autoName = team.autoName();
                acc.nameSource = team.nameSource();
                acc.ratedBattles++;
                LeagueBatchRatingCalculator.requireObservation(team.teamRating());
                acc.ratingSum = acc.ratingSum.add(BigDecimal.valueOf(team.teamRating()));
                if (team.dimensionAverages().size() != LeagueColumns.DIM_KEYS.size()) {
                    throw new IllegalStateException("Team dimension average count must be "
                            + LeagueColumns.DIM_KEYS.size() + ", got " + team.dimensionAverages().size());
                }
                for (int d = 0; d < team.dimensionAverages().size(); d++) {
                    acc.dimensionSums[d] = acc.dimensionSums[d].add(BigDecimal.valueOf(team.dimensionAverages().get(d)));
                }
                if (winner != null && team.team() == winner) {
                    acc.wins++;
                }
                acc.arenaTeams.add(battle.arenaId + ":" + team.team());
            }
        }

        final List<PlayerLeagueSummary> playerSummaries = new ArrayList<>();
        for (final Map.Entry<Long, PlayerAcc> e : players.entrySet()) {
            final PlayerAcc acc = e.getValue();
            final double rating = LeagueBatchRatingCalculator.playerRating(acc.ratingSum.doubleValue(), acc.ratedBattles);
            final double observedMean = LeagueBatchRatingCalculator.observedMean(acc.ratingSum.doubleValue(), acc.ratedBattles);
            final List<PlayerVehicleUsage> vehicleUsage = acc.vehicleCounts.entrySet().stream()
                    .map(en -> new PlayerVehicleUsage(en.getKey(), en.getValue()))
                    .sorted(Comparator.comparingLong(PlayerVehicleUsage::tankId))
                    .toList();
            playerSummaries.add(new PlayerLeagueSummary(
                    e.getKey(), acc.nickname, acc.clan, acc.ratedBattles,
                    rating, observedMean, dimensionMeans(acc.dimensionSums, acc.ratedBattles),
                    acc.mvpCount, acc.wins, acc.damageTotal, acc.assistTotal, acc.killsTotal,
                    vehicleUsage));
        }
        final List<TeamLeagueSummary> teamSummaries = new ArrayList<>();
        for (final Map.Entry<String, TeamAcc> e : teams.entrySet()) {
            final TeamAcc acc = e.getValue();
            teamSummaries.add(new TeamLeagueSummary(
                    e.getKey(), acc.autoName, acc.nameSource, acc.ratedBattles,
                    LeagueBatchRatingCalculator.teamRating(acc.ratingSum.doubleValue(), acc.ratedBattles),
                    LeagueBatchRatingCalculator.observedMean(acc.ratingSum.doubleValue(), acc.ratedBattles),
                    dimensionMeans(acc.dimensionSums, acc.ratedBattles), acc.wins,
                    List.copyOf(acc.arenaTeams)));
        }
        playerSummaries.sort(Comparator.comparingLong(PlayerLeagueSummary::accountId));
        teamSummaries.sort(Comparator.comparing(TeamLeagueSummary::teamKey));
        return new LeagueRatingBatch(results, playerSummaries, teamSummaries,
                failures == null ? List.of() : List.copyOf(failures));
    }

    /** 批次 team key：多数军团标签优先，否则 arenaId:team（禁止跨场合并所有 Team 1）。 */
    public static String teamKey(final Battle battle, final TeamLeagueRating team) {
        if (team.autoName() != null && !team.autoName().isEmpty()) {
            return "clan:" + team.autoName();
        }
        return battle.arenaId + ":" + team.team();
    }

    private static List<Double> dimensionMeans(final BigDecimal[] sums, final int ratedBattles) {
        final List<Double> out = new ArrayList<>(sums.length);
        for (final BigDecimal sum : sums) {
            out.add(ratedBattles == 0 ? 0.0 : sum.doubleValue() / ratedBattles);
        }
        return List.copyOf(out);
    }

    private static final class PlayerAcc {
        String nickname = "";
        String clan = "";
        int ratedBattles;
        BigDecimal ratingSum = BigDecimal.ZERO;
        final BigDecimal[] dimensionSums = zeroSums();
        int mvpCount;
        int wins;
        long damageTotal;
        long assistTotal;
        long killsTotal;
        final Map<Long, Integer> vehicleCounts = new HashMap<>();
    }

    private static final class TeamAcc {
        String autoName;
        String nameSource = LeagueTeamNamer.NAME_SOURCE_UNNAMED;
        int ratedBattles;
        BigDecimal ratingSum = BigDecimal.ZERO;
        final BigDecimal[] dimensionSums = zeroSums();
        int wins;
        final List<String> arenaTeams = new ArrayList<>();
    }

    private static BigDecimal[] zeroSums() {
        final BigDecimal[] sums = new BigDecimal[LeagueColumns.DIM_KEYS.size()];
        java.util.Arrays.fill(sums, BigDecimal.ZERO);
        return sums;
    }
}
