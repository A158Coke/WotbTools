package com.wotb.web.replay.dto;

import java.util.List;

/** 批次选手汇总行（V6 Rating + Observed Mean + 七维算术平均）。
 * <p>{@code rating} = V6 fixed-prior batch Rating；{@code observedMean} = actual
 * rated-battle arithmetic mean；{@code ratedBattles} = 评分场次（rated-only 样本）；
 * {@code contribution/kast/impact} 为跨场 Performance Metrics（与 resp.aggregate 同一
 * 全部已解析场次样本；HP 全 UNKNOWN 时 contribution/kast 为 null，UI 显示 "--"）。
 * {@code dimensionMeans} 用于 Summary Table、Radar 与导出。
 * {@code mostUsedVehicle} 为当前批次 rated-only 最常使用坦克；无可靠数据时为 null。</p>
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
        Double contribution,
        Double kast,
        Double impact,
        LeagueVehicleUsageDto mostUsedVehicle) {
}
