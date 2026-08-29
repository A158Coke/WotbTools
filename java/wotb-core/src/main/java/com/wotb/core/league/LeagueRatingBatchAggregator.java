package com.wotb.core.league;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 批次选手/战队中位数汇总（只做当前上传内容的即时汇总，不排序、不产生批次奖项）。
 *
 * <p>中位数规则：奇数场取中间值，偶数场取两个中间值的算术平均；使用未取整分数。
 * 不设置最低场次；必须显示参赛场次，避免用户把一场样本与多场样本视为同等可靠。</p>
 */
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
                acc.battles++;
                acc.ratings.add(p.finalRating());
                acc.dims.addAll(p.dimensionScores());
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
                acc.battles++;
                acc.ratings.add(team.teamRating());
                for (final Double d : team.dimensionAverages()) {
                    acc.dims.add(d);
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
            final double rawMedian = median(acc.ratings);
            final double batchRatingV5 = LeagueBatchPlayerRatingCalculator.apply(rawMedian, acc.battles);
            final List<PlayerVehicleUsage> vehicleUsage = acc.vehicleCounts.entrySet().stream()
                    .map(en -> new PlayerVehicleUsage(en.getKey(), en.getValue()))
                    .sorted(Comparator.comparingLong(PlayerVehicleUsage::tankId))
                    .toList();
            playerSummaries.add(new PlayerLeagueSummary(
                    e.getKey(), acc.nickname, acc.clan, acc.battles,
                    rawMedian, batchRatingV5,
                    chunkMedians(acc.dims), chunkMeans(acc.dims),
                    acc.mvpCount, acc.wins, acc.damageTotal, acc.assistTotal, acc.killsTotal,
                    vehicleUsage));
        }
        final List<TeamLeagueSummary> teamSummaries = new ArrayList<>();
        for (final Map.Entry<String, TeamAcc> e : teams.entrySet()) {
            final TeamAcc acc = e.getValue();
            teamSummaries.add(new TeamLeagueSummary(
                    e.getKey(), acc.autoName, acc.nameSource, acc.battles,
                    median(acc.ratings), chunkMedians(acc.dims), acc.wins,
                    List.copyOf(acc.arenaTeams)));
        }
        playerSummaries.sort(Comparator.comparingLong(PlayerLeagueSummary::accountId));
        teamSummaries.sort(Comparator.comparing(TeamLeagueSummary::teamKey));
        return new LeagueRatingBatch(results, playerSummaries, teamSummaries,
                failures == null ? List.of() : List.copyOf(failures),
                ratingQuality(battles));
    }

    /**
     * 统计已评分场次中 canonical death time 为 UNKNOWN 的阵亡玩家实例数。
     * UNKNOWN 是合法的评分质量 limitation，不是 failure；相关 Survival/Trade 维度继续 fail-closed。
     */
    private static LeagueRatingQuality ratingQuality(final List<Battle> battles) {
        int unknown = 0;
        if (battles != null) {
            for (final Battle battle : battles) {
                if (battle == null || battle.players == null) {
                    continue;
                }
                for (final PlayerResult p : battle.players) {
                    if (!p.survived && PlayerResultFormat.deathSec(p) <= 0) {
                        unknown++;
                    }
                }
            }
        }
        return new LeagueRatingQuality(unknown);
    }

    /** 批次 team key：多数军团标签优先，否则 arenaId:team（禁止跨场合并所有 Team 1）。 */
    public static String teamKey(final Battle battle, final TeamLeagueRating team) {
        if (team.autoName() != null && !team.autoName().isEmpty()) {
            return "clan:" + team.autoName();
        }
        return battle.arenaId + ":" + team.team();
    }

    static double median(final List<Double> values) {
        if (values == null || values.isEmpty()) {
            return 0;
        }
        final List<Double> sorted = values.stream().sorted().toList();
        final int n = sorted.size();
        final int mid = n / 2;
        if (n % 2 == 1) {
            return sorted.get(mid);
        }
        return (sorted.get(mid - 1) + sorted.get(mid)) / 2.0;
    }

    private static void validateChunkStride(final List<Double> dims) {
        final int dimensionCount = LeagueColumns.DIM_KEYS.size();
        if (dims.size() % dimensionCount != 0) {
            throw new IllegalStateException(
                    "flat dimension samples must be whole battles (stride=" + dimensionCount
                            + "), got " + dims.size());
        }
    }

    private static List<Double> chunkMedians(final List<Double> dims) {
        validateChunkStride(dims);
        final int dimensionCount = LeagueColumns.DIM_KEYS.size();
        final List<Double> out = new ArrayList<>(dimensionCount);
        for (int d = 0; d < dimensionCount; d++) {
            final List<Double> perDim = new ArrayList<>();
            for (int i = d; i < dims.size(); i += dimensionCount) {
                perDim.add(dims.get(i));
            }
            out.add(median(perDim));
        }
        return out;
    }

    static List<Double> chunkMeans(final List<Double> dims) {
        validateChunkStride(dims);
        final int dimensionCount = LeagueColumns.DIM_KEYS.size();
        final List<Double> out = new ArrayList<>(dimensionCount);
        for (int d = 0; d < dimensionCount; d++) {
            double sum = 0;
            int n = 0;
            for (int i = d; i < dims.size(); i += dimensionCount) {
                sum += dims.get(i);
                n++;
            }
            out.add(n == 0 ? 0 : sum / n);
        }
        return out;
    }

    private static final class PlayerAcc {
        String nickname = "";
        String clan = "";
        int battles;
        final List<Double> ratings = new ArrayList<>();
        final List<Double> dims = new ArrayList<>();
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
        int battles;
        final List<Double> ratings = new ArrayList<>();
        final List<Double> dims = new ArrayList<>();
        int wins;
        final List<String> arenaTeams = new ArrayList<>();
    }
}
