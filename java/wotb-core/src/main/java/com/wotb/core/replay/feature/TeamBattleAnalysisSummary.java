package com.wotb.core.replay.feature;

/** 单场队伍视角分析摘要（多场趋势用）。 */
public record TeamBattleAnalysisSummary(
        String fileName,
        String mapName,
        int perspectiveTeam,
        TeamBattleFeatureSet features
) {}
