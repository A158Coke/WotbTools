package com.wotb.core.league;

import java.util.List;

/**
 * League Rating 通用归一化纯函数（无状态、可独立测试）。
 *
 * <p>所有主要连续指标使用<b>本场数据</b>归一化，不使用历史均值、Tankopedia 期望值或全服统计。</p>
 *
 * <ul>
 *   <li>{@link #teamIndex}：本队贡献指数 T(x)——本队平均贡献对应 0.5，两倍及以上封顶 1.0。</li>
 *   <li>{@link #globalIndex}：全场排名指数 G(x)——14 名玩家内降序排列，并列共享平均名次，
 *       唯一第一=1、唯一最后=0、全场全零=0。</li>
 *   <li>{@link #wilsonLowerBound}：Wilson 95% 置信下界（射击效率小样本修正）。</li>
 * </ul>
 */
public final class LeagueRatingNormalizer {

    /** 标准 7v7 每队人数。 */
    public static final int TEAM_SIZE = 7;

    /** 全场玩家数（两队各 7 人）。 */
    public static final int TOTAL_PLAYERS = 14;

    /** Wilson 修正默认置信 z（95%）。 */
    public static final double WILSON_Z = 1.96;

    private LeagueRatingNormalizer() {
    }

    /**
     * 本队贡献指数：{@code 0 if x<=0 or teamAverage<=0; min(1, x / (2 × teamAverage)) otherwise}。
     * 本队平均贡献对应 0.5，两倍及以上对应 1.0。
     */
    public static double teamIndex(final double x, final double teamAverage) {
        if (!finitePositive(x) || !finitePositive(teamAverage)) {
            return 0;
        }
        return Math.min(1.0, x / (2.0 * teamAverage));
    }

    /**
     * 全场排名指数：在 {@code all} 中对同一指标降序排列，并列共享平均名次；
     * {@code (14 - averageRank) / 13}；指标为 0 或非有限 → 0；全场全零 → 全员 0。
     *
     * @param x   目标玩家原始值（未取整）
     * @param all 全场 14 名玩家同一指标的原始值
     */
    public static double globalIndex(final double x, final List<Double> all) {
        if (!finitePositive(x)) {
            return 0;
        }
        if (all == null || all.isEmpty()) {
            return 0;
        }
        final List<Double> sorted = all.stream()
                .filter(LeagueRatingNormalizer::finitePositive)
                .sorted(java.util.Comparator.reverseOrder())
                .toList();
        if (sorted.isEmpty()) {
            return 0;
        }
        // 并列共享平均名次：先找 >= x 的数量（严格大于的个数 + 与 x 并列的个数）
        int strictlyGreater = 0;
        int tied = 0;
        for (final Double v : sorted) {
            if (v > x) {
                strictlyGreater++;
            } else if (v == x) {
                tied++;
            } else {
                break;
            }
        }
        if (tied == 0) {
            return 0;
        }
        // 名次从 1 开始：strictlyGreater 个更大值占名次 1..strictlyGreater；
        // 并列组占 [strictlyGreater+1, strictlyGreater+tied]，平均 = strictlyGreater + (tied+1)/2.0
        final double averageRank = strictlyGreater + (tied + 1) / 2.0;
        return Math.max(0, Math.min(1.0, (TOTAL_PLAYERS - averageRank) / (TOTAL_PLAYERS - 1.0)));
    }

    /**
     * Wilson lower bound（95% 置信下界，{@value #WILSON_Z}）：小样本下不把
     * 一发一中一穿当作 100% 命中率。{@code trials<=0} → 0。
     *
     * @param successes 成功次数（命中/击穿）
     * @param trials    总次数（射击/命中）
     */
    public static double wilsonLowerBound(final double successes, final double trials) {
        return wilsonLowerBound(successes, trials, WILSON_Z);
    }

    /** Wilson lower bound，可指定 z（测试用）。 */
    public static double wilsonLowerBound(final double successes, final double trials, final double z) {
        if (!finitePositive(trials) || trials <= 0 || successes < 0 || !Double.isFinite(successes)) {
            return 0;
        }
        final double n = trials;
        final double p = Math.min(1.0, successes / n);
        final double z2 = z * z;
        final double denom = 1.0 + z2 / n;
        final double center = (p + z2 / (2.0 * n)) / denom;
        final double margin = z * Math.sqrt((p * (1.0 - p) / n) + (z2 / (4.0 * n * n))) / denom;
        return Math.max(0.0, center - margin);
    }

    /** 正有限（>0 且有限）判断。 */
    public static boolean finitePositive(final double v) {
        return Double.isFinite(v) && v > 0;
    }
}
