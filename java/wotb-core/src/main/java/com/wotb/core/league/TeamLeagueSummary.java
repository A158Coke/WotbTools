package com.wotb.core.league;

import java.util.List;

/** 批次战队汇总（V6 raw sum/count projection + seven dimension means）。 */
public record TeamLeagueSummary(
        // 批次 team key（clan 标签或 arenaId:team）
        String teamKey,
        // 自动名称（多数军团标签）；null = 待命名
        String autoName,
        // CLAN_MAJORITY / UNNAMED
        String nameSource,
        int ratedBattles,
        // V6 projected Team Rating（未取整）
        double rating,
        // arithmetic mean of actual TeamBattleRating values（未取整）
        double observedMean,
        // 七个团队维度分各自的算术平均
        List<Double> dimensionMeans,
        int wins,
        // 组成该 key 的 {arenaId}:{team} 实例列表（前端名称覆盖绑定用）
        List<String> arenaTeams) {
}
