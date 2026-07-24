package com.wotb.core.replay.feature;

/** 单场随机战斗分析摘要（多场趋势用）。 */
public record PlayerBattleAnalysisSummary(
        String fileName,
        String mapName,
        int durationSec,
        boolean victory,
        PlayerBattleFeatureSet features
) {}
