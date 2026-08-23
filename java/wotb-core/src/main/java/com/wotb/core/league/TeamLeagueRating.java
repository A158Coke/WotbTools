package com.wotb.core.league;

import java.util.List;

/** 一方战队的单场 League Rating 汇总。 */
public record TeamLeagueRating(
        int team,
        // 战队 Rating = 本队 7 名玩家 finalRating 的算术平均（未取整）
        double teamRating,
        // 八个维度分各自的本队算术平均（解释/导出用）
        List<Double> dimensionAverages,
        // 自动战队名称；null = 未达到多数标签，需用户填写
        String autoName,
        // 名称来源：CLAN_MAJORITY / UNNAMED（稳定英文码）
        String nameSource,
        // 本队队内最佳玩家（finalRating 最高；并列按 MVP 排序规则）
        PlayerLeagueRating teamBest,
        // 本队七名玩家（含各自评分）
        List<PlayerLeagueRating> players) {
}
