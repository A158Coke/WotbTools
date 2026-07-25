package com.wotb.core.replay.feature;

import java.util.List;

/**
 * 返回给前端的团队分析单元事实摘要。
 */
public record TeamAnalysisUnitReport(
        TeamAggregateResult authoritativeAggregate,
        TeamObservedAggregate observedAggregate,
        TeamFeatureCoverage coverage,
        List<String> limitations
) {

    public TeamAnalysisUnitReport {
        limitations = limitations == null ? List.of() : List.copyOf(limitations);
    }
}
