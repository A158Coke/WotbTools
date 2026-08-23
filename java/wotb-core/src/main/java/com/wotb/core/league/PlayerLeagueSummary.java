package com.wotb.core.league;

import java.util.List;

/** 批次选手汇总（按 accountId；参赛场次 + finalRating/八维度中位数 + MVP 次数 + 关键原始统计）。 */
public record PlayerLeagueSummary(
        long accountId,
        String nickname,
        String clan,
        int battles,
        // finalRating 中位数（未取整）
        double ratingMedian,
        // 八个维度分各自的中位数（未取整）
        List<Double> dimensionMedians,
        // MVP 次数（仅原始汇总数据展示，不产生批次奖项）
        int mvpCount,
        int wins,
        long damageTotal,
        long assistTotal,
        long killsTotal) {
}
