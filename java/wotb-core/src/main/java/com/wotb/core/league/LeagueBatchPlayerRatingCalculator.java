package com.wotb.core.league;

/**
 * League Rating V5 Batch Player Evidence Adjustment（纯函数，无 Spring/DTO/DB/IO）。
 *
 * <p>输入：玩家自己的 Raw Batch Median（全部有效单场 V4.1 Final Rating 的中位数）与
 * 有效评分场次数 {@code n}；输出：V5 Batch Player Rating。</p>
 *
 * <p>正式公式（canonical 定义见 {@code docs/WotBTools_League_Rating_V5.md}）：</p>
 * <pre>
 *   E(n) = 1 - exp(-n / EVIDENCE_TIME_CONSTANT)
 *   V5   = rawMedian                                     (rawMedian &le; V5_EVIDENCE_ANCHOR)
 *   V5   = ANCHOR + E(n) * (rawMedian - ANCHOR)          (rawMedian &gt; ANCHOR)
 *   V5   = clamp(V5, 0, 1000)
 * </pre>
 *
 * <p>硬边界（禁止修改）：</p>
 * <ul>
 *   <li>Anchor 固定 450，禁止动态 batch/team/population median 或历史数据库。</li>
 *   <li>单边调整：{@code rawMedian <= 450} 完全不加分（无 symmetric shrinkage）。</li>
 *   <li>无 hard release threshold（不存在 n>=X 后 100% 释放），Evidence 连续趋近 1。</li>
 *   <li>Evidence 只依赖该玩家自己的有效评分场次数 n；与同批其他玩家/战队/赛事阶段无关。</li>
 * </ul>
 */
public final class LeagueBatchPlayerRatingCalculator {

    /** V5 固定 evidence anchor（禁止动态计算）。 */
    public static final double V5_EVIDENCE_ANCHOR = 450.0;

    /** Evidence 时间常数 tau=6（唯一事实源，禁止散落 magic number）。 */
    public static final double EVIDENCE_TIME_CONSTANT = 6.0;

    /** 最终分上限（与 {@link PlayerLeagueRating#MAX_FINAL} 一致）。 */
    public static final double MAX_FINAL = PlayerLeagueRating.MAX_FINAL;

    private LeagueBatchPlayerRatingCalculator() {
    }

    /**
     * Evidence 曲线 {@code E(n) = 1 - exp(-n / 6)}（内部 double 精度，不做人为 rounding）。
     *
     * @param ratedBattleCount 玩家自己的有效评分场次数
     * @return E(n)，严格满足 0 &lt; E(n) &lt; 1 且随 n 单调递增（n 有限正数时）
     */
    public static double evidence(final int ratedBattleCount) {
        requirePositive(ratedBattleCount);
        return 1.0 - Math.exp(-ratedBattleCount / EVIDENCE_TIME_CONSTANT);
    }

    /**
     * V5 Batch Player Rating（正式唯一公式，含 0–1000 clamp）。
     *
     * @param rawMedian        玩家自己的单场 V4.1 Final Rating 中位数（未取整）
     * @param ratedBattleCount 玩家自己的有效评分场次数（must be &gt; 0）
     * @return V5 Batch Player Rating（finite，[0, 1000]）
     */
    public static double apply(final double rawMedian, final int ratedBattleCount) {
        requirePositive(ratedBattleCount);
        if (!Double.isFinite(rawMedian)) {
            throw new IllegalArgumentException(
                    "rawBatchMedian must be finite, got " + rawMedian);
        }
        final double v5;
        if (rawMedian <= V5_EVIDENCE_ANCHOR) {
            v5 = rawMedian;
        } else {
            v5 = V5_EVIDENCE_ANCHOR
                    + evidence(ratedBattleCount) * (rawMedian - V5_EVIDENCE_ANCHOR);
        }
        final double clamped = Math.max(0.0, Math.min(MAX_FINAL, v5));
        if (!Double.isFinite(clamped)) {
            // domain invariant 被破坏时 fail closed，禁止静默转换成 0 掩盖 bug。
            throw new IllegalStateException("V5 rating must be finite, got " + clamped);
        }
        return clamped;
    }

    private static void requirePositive(final int ratedBattleCount) {
        if (ratedBattleCount <= 0) {
            throw new IllegalArgumentException(
                    "ratedBattleCount must be positive, got " + ratedBattleCount);
        }
    }
}
