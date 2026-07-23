package com.wotb.core.replay.feature;

import com.wotb.core.processing.RecorderIdentity;

import java.util.List;

/**
 * 多场随机战斗 AI 分析上下文（同一录像者个人趋势）。
 */
public record MultiPlayerBattleAnalysisContext(
        RecorderIdentity recorder,
        int battleCount,
        List<PlayerBattleAnalysisSummary> battles,
        List<String> limitations
) {

    public record PlayerBattleAnalysisSummary(
            String fileName,
            String mapName,
            int durationSec,
            boolean victory,
            PlayerBattleFeatureSet features
    ) {}

    public record PlayerAggregate(
            double avgDamage,
            double avgSurvivalTime,
            double winRate
    ) {}
}
