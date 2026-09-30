package com.wotb.web.replay.dto;

import java.util.List;

/** 批次选手汇总行（V6 Rating + Observed Mean + 七维算术平均）。
 * <p>{@code rating} = V6 fixed-prior batch Rating；{@code observedMean} = actual
 * rated-battle arithmetic mean；{@code ratedBattles} = 评分场次（rated-only 样本）。
 * {@code dimensionMeans} 用于 Summary Table、Radar 与导出。
 * {@code mostUsedVehicle} 为当前批次 rated-only 最常使用坦克；无可靠数据时为 null。
 * <p><b>B6</b>：{@code contribution}/{@code kast}/{@code impact} 已退役（见
 * {@code docs/ROADMAP.md} Not planned）。</p>
 */
public record LeaguePlayerSummaryDto(
        long accountId,
        String nickname,
        String clan,
        int ratedBattles,
        // V6 Batch Player Rating（批次主 Rating，未取整）
        double rating,
        // Observed Mean（V4.1 单场 Rating 算术平均，未取整）
        double observedMean,
        List<Double> dimensionMeans,
        int mvpCount,
        int wins,
        long damageTotal,
        long assistTotal,
        long killsTotal,
        LeagueVehicleUsageDto mostUsedVehicle) {
}
