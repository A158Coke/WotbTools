package com.wotb.web.replay.dto;

import java.util.List;

/** 批次选手汇总行（Rating 中位数 + 七维中位数 + 七维算术平均）。
 * <p>{@code battles} = 评分场次（rated-only 样本）；{@code contribution/kast/impact} 为
 * 跨场 Performance Metrics（与 resp.aggregate 同一全部已解析场次样本；HP 全 UNKNOWN 时
 * contribution/kast 为 null，UI 显示 "--"）。{@code dimensionMeans} 仅供 Summary Radar
 * 使用（arithmetic mean of rated-battle scores），与 {@code dimensionMedians}
 * （Table 典型比赛得分）语义严格分离。</p>
 */
public record LeaguePlayerSummaryDto(
        long accountId,
        String nickname,
        String clan,
        int battles,
        double ratingMedian,
        List<Double> dimensionMedians,
        List<Double> dimensionMeans,
        int mvpCount,
        int wins,
        long damageTotal,
        long assistTotal,
        long killsTotal,
        Double contribution,
        Double kast,
        Double impact) {
}
