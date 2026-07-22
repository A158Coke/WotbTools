package com.wotb.core.replay.feature;

import java.util.List;

/**
 * 多场 AI 分析上下文（预留模型，后续实现 MultiBattleAiInputFactory 时使用）。
 *
 * TODO: implement MultiBattleAiInputFactory + ReplayBatchAggregator in next phase
 */
public record MultiBattleAnalysisContext(
        int battleCount,
        List<BattleAnalysisSummary> battles,
        AggregateStats aggregateStats,
        List<String> limitations
) {

    /** 单场分析摘要。 */
    public record BattleAnalysisSummary(
            String fileName,
            String mapName,
            int durationSec,
            boolean victory,
            BattleFeatureSet features
    ) {
    }

    /** 聚合统计（占位）。 */
    public record AggregateStats(
            double avgDamage,
            double winRate,
            double avgSurvivalTime
    ) {
    }
}
