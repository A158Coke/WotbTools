package com.wotb.core.replay.feature;

import java.util.List;

/**
 * 返回给前端的团队分析单元事实摘要。
 */
public record TeamAnalysisUnitReport(
        TeamAggregateResult authoritativeAggregate,
        TeamObservedAggregate observedAggregate,
        TeamFeatureCoverage coverage,
        List<String> limitations,
        List<KeyBattleEvent> keyEvents,
        String analysisText,
        String model
) {

    public TeamAnalysisUnitReport {
        limitations = limitations == null ? List.of() : List.copyOf(limitations);
        keyEvents = keyEvents == null ? List.of() : List.copyOf(keyEvents);
    }

    public TeamAnalysisUnitReport(
            TeamAggregateResult authoritativeAggregate,
            TeamObservedAggregate observedAggregate,
            TeamFeatureCoverage coverage,
            List<String> limitations
    ) {
        this(authoritativeAggregate, observedAggregate, coverage, limitations, List.of(), null, null);
    }

    public TeamAnalysisUnitReport(
            TeamAggregateResult authoritativeAggregate,
            TeamObservedAggregate observedAggregate,
            TeamFeatureCoverage coverage,
            List<String> limitations,
            String analysisText,
            String model
    ) {
        this(authoritativeAggregate, observedAggregate, coverage, limitations, List.of(), analysisText, model);
    }
}
