package com.wotb.web.replay.dto;

import java.util.List;

/** 批次战队汇总行（战队中位数汇总）。 */
public record LeagueTeamSummaryDto(
        String teamKey,
        String autoName,
        String nameSource,
        int battles,
        double ratingMedian,
        List<Double> dimensionMedians,
        int wins,
        List<String> arenaTeams) {
}
