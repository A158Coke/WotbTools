package com.wotb.web.replay.dto;

import java.util.List;

/** 单场一方战队 Rating（名称 + 战队分 + 维度平均 + 队内最佳）。 */
public record LeagueTeamDto(
        int team,
        // 批次 team key（clan 多数标签或 arenaId:team；前端名称覆盖绑定用）
        String teamKey,
        double teamRating,
        List<Double> dimensionAverages,
        String autoName,
        String nameSource,
        String teamBestNickname,
        long teamBestAccountId) {
}
