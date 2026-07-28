package com.wotb.core.replay.feature;

import java.util.List;

/**
 * Multi-perspective team battle analysis context.
 * {@code uniqueBattleCount} is the count of distinct battle identities
 * across all perspectives (opposing perspectives share the same battle).
 */
public record MultiTeamBattleAnalysisContext(
        int perspectiveCount,
        int uniqueBattleCount,
        List<TeamBattleAnalysisSummary> perspectives,
        boolean rosterConsistent,
        List<String> limitations
) {
    public MultiTeamBattleAnalysisContext {
        perspectives = perspectives == null ? List.of() : List.copyOf(perspectives);
        limitations = limitations == null ? List.of() : List.copyOf(limitations);
    }
}
