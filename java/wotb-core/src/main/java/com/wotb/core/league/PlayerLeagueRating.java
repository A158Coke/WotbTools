package com.wotb.core.league;

import java.util.List;

/** 一名玩家的一场 League Rating 结果（七维分 + 汇总分 + MVP 标记 + Rating 关键原始字段）。 */
public record PlayerLeagueRating(
        long accountId,
        String nickname,
        String clan,
        int team,
        // 七个维度分（未取整，全部 [0, dimensionMax]）
        double damageScore,
        double assistScore,
        double killScore,
        double exchangeScore,
        double blockedScore,
        double survivalTradeScore,
        double shootingScore,
        // 不含存活分与胜方倍率的 preliminary 分（败方前四判断用）
        double preliminary,
        // 基础分 = 七个维度之和（未取整）
        double baseRating,
        // 最终分：胜方 ×1.05（封顶 1000），败方 = baseRating（未取整）
        double finalRating,
        // 存活状态分来源：WIN_SURVIVED / TRADE / LOSER_TOP4 / NONE（稳定英文码）
        String survivalState,
        // Rating 关键原始字段（MVP/队内最佳并列排序与导出展示用，不参与公式）
        int damageDealt,
        int damageAssisted,
        int kills,
        boolean survived,
        // 全场 MVP
        boolean mvp,
        // 本队最佳
        boolean teamBest) {

    /** Rating 维度满分常量，合计 1000。 */
    public static final double MAX_DAMAGE = 400;
    public static final double MAX_ASSIST = 100;
    public static final double MAX_KILL = 100;
    public static final double MAX_EXCHANGE = 150;
    public static final double MAX_BLOCKED = 50;
    public static final double MAX_SURVIVAL_TRADE = 100;
    public static final double MAX_SHOOTING = 100;
    /** 最终分上限。 */
    public static final double MAX_FINAL = 1000;

    /**
     * 七维分数的唯一有序表示（顺序严格与 {@link LeagueColumns#DIM_KEYS} 一致）。
     *
     * <p>consumer（Mapper / Excel 单场 / Excel 批量 / 批次聚合）一律消费本方法，
     * 禁止自行重写 {@code List.of(damageScore(), assistScore(), ...)} 数组——
     * 维度增删时只有本方法知道顺序，杜绝「某个 consumer 静默漏一维」。</p>
     */
    public List<Double> dimensionScores() {
        return List.of(damageScore, assistScore, killScore, exchangeScore,
                blockedScore, survivalTradeScore, shootingScore);
    }
}
