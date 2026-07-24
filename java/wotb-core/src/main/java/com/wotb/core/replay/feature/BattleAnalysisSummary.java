package com.wotb.core.replay.feature;

/** 单场分析摘要。 */
public record BattleAnalysisSummary(
        String fileName,
        String mapName,
        int durationSec,
        boolean victory,
        BattleFeatureSet features
) {}
