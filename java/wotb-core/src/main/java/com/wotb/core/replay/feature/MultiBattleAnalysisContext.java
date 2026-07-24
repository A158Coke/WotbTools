package com.wotb.core.replay.feature;

import java.util.List;

/**
 * 多场 AI 分析上下文（预留模型，后续实现 MultiBattleAiInputFactory + ReplayBatchAggregator）。
 */
public record MultiBattleAnalysisContext(
        int battleCount,
        List<BattleAnalysisSummary> battles,
        AggregateStats aggregateStats,
        List<String> limitations
) {
}
