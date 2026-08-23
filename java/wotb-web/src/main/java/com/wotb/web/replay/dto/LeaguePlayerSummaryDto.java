package com.wotb.web.replay.dto;

import java.util.List;

/** 批次选手汇总行（选手中位数汇总）。 */
public record LeaguePlayerSummaryDto(
        long accountId,
        String nickname,
        String clan,
        int battles,
        double ratingMedian,
        List<Double> dimensionMedians,
        int mvpCount,
        int wins,
        long damageTotal,
        long assistTotal,
        long killsTotal) {
}
