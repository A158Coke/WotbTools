package com.wotb.core.league;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.facts.TradeFacts;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.function.ToDoubleFunction;

/**
 * League Rating 计算器（纯数学、无 Spring、无副作用）。
 *
 * <p>只消费当前回放解析出的权威事实，不使用 Tankopedia HP、历史均值、
 * Potential Damage、XP/Credits、AI 或外部统计。七个维度合计满分 1000；
 * 胜方最终分 ×1.05（封顶 1000），败方不扣分。</p>
 *
 * <p>前置条件：调用方先经 {@link LeagueRatingValidator} 确认 7v7 完整性
 * （14 唯一账号、队伍 7/7、tankId、rosterComplete、明确胜方、阵亡时间可靠、数值关系合法）。
 * 若前置校验失败，本计算器不产生 Rating（调用方按失败处理）。</p>
 */
public final class LeagueRatingCalculator {

    /** 维度权重 [teamWeight, globalWeight]（顺序：伤害/助攻/击杀/换血/阻挡）。 */
    private static final double[][] DIM_WEIGHTS = {
            {0.60, 0.40},   // 伤害
            {0.70, 0.30},   // 助攻
            {0.40, 0.60},   // 击杀
            {0.30, 0.70},   // 换血效率
            {0.70, 0.30},   // 阻挡
    };

    private LeagueRatingCalculator() {
    }

    /** 存活状态稳定英文码。 */
    public static final String STATE_WIN_SURVIVED = "WIN_SURVIVED";
    public static final String STATE_TRADE = "TRADE";
    public static final String STATE_LOSER_TOP4 = "LOSER_TOP4";
    public static final String STATE_NONE = "NONE";

    /**
     * 计算一场 battle 的完整 League Rating。
     *
     * @param battle 已通过完整性校验的 7v7 battle
     */
    public static LeagueRatingResult calculate(final Battle battle) {
        final List<PlayerResult> players = battle.players;
        final int n = players.size();
        final int winner = battle.winnerTeam;

        // ---- 每队平均值（未取整） ----
        final double[] teamAvgDamage = teamAverages(players, p -> p.damageDealt);
        final double[] teamAvgAssist = teamAverages(players, p -> p.damageAssisted);
        final double[] teamAvgKills = teamAverages(players, p -> p.kills);
        final double[] teamAvgBlocked = teamAverages(players, p -> p.damageBlocked);
        final double[] teamAvgEffectiveOutput = teamAverages(players, p -> effectiveOutput(p));

        // ---- 全场排名指数（未取整值） ----
        final List<Double> allDamage = values(players, p -> (double) p.damageDealt);
        final List<Double> allAssist = values(players, p -> (double) p.damageAssisted);
        final List<Double> allKills = values(players, p -> (double) p.kills);
        final List<Double> allBlocked = values(players, p -> (double) p.damageBlocked);

        // ---- 维度分 ----
        final double[] damage = new double[n];
        final double[] assist = new double[n];
        final double[] kill = new double[n];
        final double[] blocked = new double[n];
        final double[] exchange = new double[n];
        final double[] shooting = new double[n];

        final double[] exchangeEff = new double[n];
        final double[] damageParticipation = new double[n];
        final List<Double> allExchange = new ArrayList<>(n);

        for (int i = 0; i < n; i++) {
            final PlayerResult p = players.get(i);
            final int t = p.team;
            damage[i] = dim(PlayerLeagueRating.MAX_DAMAGE, DIM_WEIGHTS[0],
                    LeagueRatingNormalizer.teamIndex(p.damageDealt, teamAvgDamage[t]),
                    LeagueRatingNormalizer.globalIndex(p.damageDealt, allDamage));
            assist[i] = dim(PlayerLeagueRating.MAX_ASSIST, DIM_WEIGHTS[1],
                    LeagueRatingNormalizer.teamIndex(p.damageAssisted, teamAvgAssist[t]),
                    LeagueRatingNormalizer.globalIndex(p.damageAssisted, allAssist));
            kill[i] = dim(PlayerLeagueRating.MAX_KILL, DIM_WEIGHTS[2],
                    LeagueRatingNormalizer.teamIndex(p.kills, teamAvgKills[t]),
                    LeagueRatingNormalizer.globalIndex(p.kills, allKills));
            blocked[i] = dim(PlayerLeagueRating.MAX_BLOCKED, DIM_WEIGHTS[4],
                    LeagueRatingNormalizer.teamIndex(p.damageBlocked, teamAvgBlocked[t]),
                    LeagueRatingNormalizer.globalIndex(p.damageBlocked, allBlocked));

            // 换血效率：O/(O+received) × 参与度（参与度=O/本队平均有效输出，封顶 1）
            final double o = effectiveOutput(p);
            final double participation = LeagueRatingNormalizer.finitePositive(teamAvgEffectiveOutput[t])
                    ? Math.min(1.0, o / teamAvgEffectiveOutput[t]) : 0;
            final double oe = o + p.damageReceived;
            exchangeEff[i] = oe <= 0 ? 0 : (o / oe) * participation;
            allExchange.add(exchangeEff[i]);

            // 射击效率：命中 30% / 击穿 70% 的 Wilson 下界合成 × 伤害参与
            final double acc = LeagueRatingNormalizer.wilsonLowerBound(p.nHitsDealt, p.nShots);
            final double pen = LeagueRatingNormalizer.wilsonLowerBound(p.nPenetrationsDealt, p.nHitsDealt);
            final double shootingConfidence = 0.30 * acc + 0.70 * pen;
            damageParticipation[i] = LeagueRatingNormalizer.finitePositive(teamAvgDamage[t])
                    ? Math.min(1.0, p.damageDealt / teamAvgDamage[t]) : 0;
            shooting[i] = PlayerLeagueRating.MAX_SHOOTING
                    * Math.min(1.0, shootingConfidence / 0.70)
                    * damageParticipation[i];
        }

        // 换血维度的本队平均值需等 exchangeEff 全部算完
        final double[] teamAvgExchange = new double[]{0, 0, 0};
        {
            final double[] sums = new double[3];
            final int[] counts = new int[3];
            for (int i = 0; i < n; i++) {
                final int t = players.get(i).team;
                if (t == 1 || t == 2) {
                    sums[t] += exchangeEff[i];
                    counts[t]++;
                }
            }
            for (final int t : new int[]{1, 2}) {
                teamAvgExchange[t] = counts[t] == 0 ? 0 : sums[t] / counts[t];
            }
        }
        for (int i = 0; i < n; i++) {
            exchange[i] = dim(PlayerLeagueRating.MAX_EXCHANGE, DIM_WEIGHTS[3],
                    LeagueRatingNormalizer.teamIndex(exchangeEff[i], teamAvgExchange[players.get(i).team]),
                    LeagueRatingNormalizer.globalIndex(exchangeEff[i], allExchange));
        }

        // ---- preliminary（不含存活分与胜方倍率）+ 败方存活前四 ----
        final double[] preliminary = new double[n];
        final List<List<Integer>> loserSurvived = new ArrayList<>();
        loserSurvived.add(new ArrayList<>());
        loserSurvived.add(new ArrayList<>());
        loserSurvived.add(new ArrayList<>());
        for (int i = 0; i < n; i++) {
            preliminary[i] = damage[i] + assist[i] + kill[i] + exchange[i] + blocked[i] + shooting[i];
            final PlayerResult p = players.get(i);
            if (p.team != winner && p.survived) {
                loserSurvived.get(p.team).add(i);
            }
        }
        final int[][] loserTop4 = new int[3][];
        for (final int t : new int[]{1, 2}) {
            final List<Integer> idx = loserSurvived.get(t);
            idx.sort(top4Comparator(players, preliminary));
            loserTop4[t] = new int[Math.min(4, idx.size())];
            for (int k = 0; k < loserTop4[t].length; k++) {
                loserTop4[t][k] = idx.get(k);
            }
        }

        // ---- 存活状态分 + 最终分 ----
        final List<PlayerLeagueRating> built = new ArrayList<>(n);
        for (int i = 0; i < n; i++) {
            final PlayerResult p = players.get(i);
            final boolean win = p.team == winner;
            final double survival;
            final String state;
            if (win && p.survived) {
                survival = PlayerLeagueRating.MAX_SURVIVAL_TRADE;
                state = STATE_WIN_SURVIVED;
            } else if (!p.survived && TradeFacts.tradedDeaths(p, players) > 0) {
                survival = 0.75 * PlayerLeagueRating.MAX_SURVIVAL_TRADE;
                state = STATE_TRADE;
            } else if (!win && p.survived && inTop4(loserTop4[p.team], i)) {
                survival = 0.50 * PlayerLeagueRating.MAX_SURVIVAL_TRADE;
                state = STATE_LOSER_TOP4;
            } else {
                survival = 0;
                state = STATE_NONE;
            }
            final double base = preliminary[i] + survival;
            final double finalRating = win ? Math.min(PlayerLeagueRating.MAX_FINAL, base * 1.05) : base;
            built.add(new PlayerLeagueRating(
                    p.accountId, p.nickname, p.clan, p.team,
                    damage[i], assist[i], kill[i], exchange[i], blocked[i],
                    survival, shooting[i],
                    preliminary[i], base, finalRating, state,
                    p.damageDealt, p.damageAssisted, p.kills, p.survived,
                    false, false));
        }

        // ---- MVP / 队内最佳（同一玩家可同时拥有；replaceAll 后必须取回带标记的对象） ----
        final Comparator<PlayerLeagueRating> mvpOrder = mvpComparator(winner);
        final PlayerLeagueRating rawMvp = built.stream().max(mvpOrder).orElse(null);
        if (rawMvp != null) {
            final long mvpAccount = rawMvp.accountId();
            built.replaceAll(p -> p.accountId() == mvpAccount ? withFlags(p, true, p.teamBest()) : p);
        }
        for (final int t : new int[]{1, 2}) {
            final PlayerLeagueRating best = built.stream()
                    .filter(p -> p.team() == t)
                    .max(mvpOrder).orElse(null);
            if (best != null) {
                final long bestAccount = best.accountId();
                built.replaceAll(p -> p.accountId() == bestAccount ? withFlags(p, p.mvp(), true) : p);
            }
        }
        final PlayerLeagueRating mvp = rawMvp == null ? null : byAccount(built, rawMvp.accountId());

        // ---- 战队评分 ----
        final List<PlayerLeagueRating> team1Players = built.stream().filter(p -> p.team() == 1).toList();
        final List<PlayerLeagueRating> team2Players = built.stream().filter(p -> p.team() == 2).toList();

        return new LeagueRatingResult(battle.arenaId, List.copyOf(built),
                teamRating(1, team1Players, winner),
                teamRating(2, team2Players, winner),
                mvp, true);
    }

    // ---- 维度合成 ----

    /** {@code componentMax × (teamWeight × T + globalWeight × G)}，限制在 [0, max]。 */
    private static double dim(final double max, final double[] weights,
                              final double t, final double g) {
        return clamp(max * (weights[0] * t + weights[1] * g), max);
    }

    // ---- 统计辅助 ----

    /** 有效输出 O = damage + 0.6×assist + 0.35×blocked。 */
    static double effectiveOutput(final PlayerResult p) {
        return p.damageDealt + 0.60 * p.damageAssisted + 0.35 * p.damageBlocked;
    }

    /** 每队（1/2）平均值；[0] 不使用。 */
    private static double[] teamAverages(final List<PlayerResult> players,
                                         final ToDoubleFunction<PlayerResult> getter) {
        final double[] sums = new double[3];
        final int[] counts = new int[3];
        for (final PlayerResult p : players) {
            final int t = p.team;
            if (t == 1 || t == 2) {
                sums[t] += getter.applyAsDouble(p);
                counts[t]++;
            }
        }
        return new double[]{0,
                counts[1] == 0 ? 0 : sums[1] / counts[1],
                counts[2] == 0 ? 0 : sums[2] / counts[2]};
    }

    private static List<Double> values(final List<PlayerResult> players,
                                       final ToDoubleFunction<PlayerResult> getter) {
        final List<Double> out = new ArrayList<>(players.size());
        for (final PlayerResult p : players) {
            out.add(getter.applyAsDouble(p));
        }
        return out;
    }

    private static double clamp(final double v, final double max) {
        if (Double.isNaN(v) || Double.isInfinite(v) || v <= 0) {
            return 0;
        }
        return Math.min(max, v);
    }

    private static PlayerLeagueRating byAccount(final List<PlayerLeagueRating> list, final long accountId) {
        for (final PlayerLeagueRating p : list) {
            if (p.accountId() == accountId) {
                return p;
            }
        }
        return null;
    }

    private static boolean inTop4(final int[] top4, final int index) {
        for (final int t : top4) {
            if (t == index) {
                return true;
            }
        }
        return false;
    }

    private static PlayerLeagueRating withFlags(final PlayerLeagueRating p,
                                                final boolean mvp, final boolean teamBest) {
        return new PlayerLeagueRating(p.accountId(), p.nickname(), p.clan(), p.team(),
                p.damageScore(), p.assistScore(), p.killScore(), p.exchangeScore(),
                p.blockedScore(), p.survivalTradeScore(), p.shootingScore(),
                p.preliminary(), p.baseRating(), p.finalRating(), p.survivalState(),
                p.damageDealt(), p.damageAssisted(), p.kills(), p.survived(),
                mvp, teamBest);
    }

    // ---- 排序 ----

    /** 败方存活前四：preliminary → damageDealt → damageAssisted → kills → accountId（稳定技术排序）。 */
    private static Comparator<Integer> top4Comparator(final List<PlayerResult> players,
                                                      final double[] preliminary) {
        return (a, b) -> {
            int c = Double.compare(preliminary[b], preliminary[a]);
            if (c != 0) return c;
            c = Integer.compare(players.get(b).damageDealt, players.get(a).damageDealt);
            if (c != 0) return c;
            c = Integer.compare(players.get(b).damageAssisted, players.get(a).damageAssisted);
            if (c != 0) return c;
            c = Integer.compare(players.get(b).kills, players.get(a).kills);
            if (c != 0) return c;
            return Long.compare(players.get(a).accountId, players.get(b).accountId);
        };
    }

    /** MVP/队内最佳排序：finalRating → 胜方优先 → damageDealt → damageAssisted → kills → accountId。 */
    static Comparator<PlayerLeagueRating> mvpComparator(final int winnerTeam) {
        return (a, b) -> {
            int c = Double.compare(a.finalRating(), b.finalRating());
            if (c != 0) return c;
            c = Boolean.compare(a.team() == winnerTeam, b.team() == winnerTeam);
            if (c != 0) return c;
            c = Integer.compare(a.damageDealt(), b.damageDealt());
            if (c != 0) return c;
            c = Integer.compare(a.damageAssisted(), b.damageAssisted());
            if (c != 0) return c;
            c = Integer.compare(a.kills(), b.kills());
            if (c != 0) return c;
            return Long.compare(a.accountId(), b.accountId());
        };
    }

    /** 战队评分：7 人 finalRating 算术平均 + 维度分平均 + 队内最佳 + 自动名称。 */
    private static TeamLeagueRating teamRating(final int team, final List<PlayerLeagueRating> players,
                                               final int winnerTeam) {
        final int n = players.size();
        if (n == 0) {
            return new TeamLeagueRating(team, 0, List.of(), null,
                    LeagueTeamNamer.NAME_SOURCE_UNNAMED, null, List.of());
        }
        double sum = 0;
        final double[] dimSums = new double[7];
        for (final PlayerLeagueRating p : players) {
            sum += p.finalRating();
            dimSums[0] += p.damageScore();
            dimSums[1] += p.assistScore();
            dimSums[2] += p.killScore();
            dimSums[3] += p.exchangeScore();
            dimSums[4] += p.blockedScore();
            dimSums[5] += p.survivalTradeScore();
            dimSums[6] += p.shootingScore();
        }
        final List<Double> dimAverages = new ArrayList<>(7);
        for (final double d : dimSums) {
            dimAverages.add(d / n);
        }
        final PlayerLeagueRating best = players.stream().max(mvpComparator(winnerTeam)).orElse(null);
        return new TeamLeagueRating(team, sum / n, dimAverages,
                LeagueTeamNamer.autoName(players), LeagueTeamNamer.nameSource(players),
                best, List.copyOf(players));
    }
}
