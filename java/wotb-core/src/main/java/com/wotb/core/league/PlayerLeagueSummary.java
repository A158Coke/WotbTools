package com.wotb.core.league;

import java.util.List;

/**
 * 批次选手汇总（按 accountId；参赛场次 + finalRating 中位数 + 七维度中位数/算术平均
 * + MVP 次数 + 关键原始统计）。
 *
 * <p>两个维度聚合语义<b>必须严格区分</b>（禁止把 mean 改名成 median 或反之）：
 * <ul>
 * <li>{@code dimensionMedians}：Table / Excel 的「典型比赛得分」契约（保留）；</li>
 * <li>{@code dimensionMeans}：Summary Radar 的「当前批次平均能力画像」契约
 *     （arithmetic mean of rated-battle dimension scores；分母 = 评分场次，不含
 *     Rating-ineligible 场次；UNKNOWN death-time 场次是合法 rated sample，
 *     其中 Survival/Trade 的真实 0 必须进入 mean，不能过滤）。</li>
 * </ul>
 * 两者都只是 presentation / player-profile visualization，不参与 finalRating /
 * MVP / Team Rating 计算。</p>
 */
public record PlayerLeagueSummary(
        long accountId,
        String nickname,
        String clan,
        int battles,
        // finalRating 中位数（未取整）
        double ratingMedian,
        // 七个维度分各自的中位数（未取整；Table/Excel 典型比赛得分契约）
        List<Double> dimensionMedians,
        // 七个维度分各自的算术平均（未取整；Summary Radar 平均能力画像契约）
        List<Double> dimensionMeans,
        // MVP 次数（仅原始汇总数据展示，不产生批次奖项）
        int mvpCount,
        int wins,
        long damageTotal,
        long assistTotal,
        long killsTotal) {
}
