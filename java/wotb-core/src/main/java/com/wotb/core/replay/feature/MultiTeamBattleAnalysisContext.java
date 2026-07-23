package com.wotb.core.replay.feature;

import java.util.List;

/**
 * 多场训练房/联赛队伍视角 AI 分析上下文。
 */
public record MultiTeamBattleAnalysisContext(
        int perspectiveCount,
        List<TeamBattleAnalysisSummary> perspectives,
        List<String> limitations
) {
}
