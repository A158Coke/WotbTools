package com.wotb.web.replay.dto;

import java.util.List;

/** 批次战队汇总行（V6 Rating + Observed Mean + 七维算术平均）。 */
public record LeagueTeamSummaryDto(
        String teamKey,
        String autoName,
        String nameSource,
        int ratedBattles,
        double rating,
        double observedMean,
        List<Double> dimensionMeans,
        int wins,
        List<String> arenaTeams) {
}
