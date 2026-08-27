package com.wotb.web.replay.dto;

import java.util.List;

/** 批次选手汇总行（V5 Batch Rating + Raw Observed Median + 七维中位数/算术平均）。
 * <p>{@code ratingV5} = V5 Batch Player Rating（Evidence Adjustment 后的批次主 Rating）；
 * {@code ratingRawMedian} = Raw Observed Median（玩家自己的单场 V4.1 Rating 中位数，
 * explainability 信息，不参与主排序）。{@code battles} = 评分场次（rated-only 样本）；
 * {@code contribution/kast/impact} 为跨场 Performance Metrics（与 resp.aggregate 同一
 * 全部已解析场次样本；HP 全 UNKNOWN 时 contribution/kast 为 null，UI 显示 "--"）。
 * {@code dimensionMeans} 仅供 Summary Radar 使用（arithmetic mean of rated-battle
 * scores），与 {@code dimensionMedians}（Table 典型比赛得分）语义严格分离。
 * {@code mostUsedVehicle} 为当前批次 rated-only 最常使用坦克；无可靠数据时为 null。</p>
 */
public record LeaguePlayerSummaryDto(
        long accountId,
        String nickname,
        String clan,
        int battles,
        // V5 Batch Player Rating（批次主 Rating，未取整）
        double ratingV5,
        // Raw Observed Median（V4.1 单场 Rating 中位数，未取整；explainability）
        double ratingRawMedian,
        List<Double> dimensionMedians,
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
