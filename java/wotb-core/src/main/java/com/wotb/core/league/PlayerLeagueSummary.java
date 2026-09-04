package com.wotb.core.league;

import java.util.List;

/** 批次选手汇总（V6 raw sum/count projection + seven dimension means）。 */
public record PlayerLeagueSummary(
        long accountId,
        String nickname,
        String clan,
        int ratedBattles,
        // V6 projected Rating（未取整）
        double rating,
        // arithmetic mean of actual V4.1 Final Ratings（未取整）
        double observedMean,
        // 七个维度分各自的算术平均（未取整；rated-only）
        List<Double> dimensionMeans,
        // MVP 次数（仅原始汇总数据展示，不产生批次奖项）
        int mvpCount,
        int wins,
        long damageTotal,
        long assistTotal,
        long killsTotal,
        // 每辆坦克的使用场次直方图（tankId -> battles，仅 rated-only 样本；不含 Tankopedia 名称）
        List<PlayerVehicleUsage> vehicleUsage) {
}
