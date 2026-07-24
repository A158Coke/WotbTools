package com.wotb.core.processing;

import com.wotb.core.replay.feature.KeyBattleEvent;

import java.util.List;

/**
 * AI 分析统一响应（扩展版）。
 */
public record AnalyzeResponse(
        ReplayAnalysisMode mode,
        int submittedFileCount,
        int validFileCount,
        int analysisUnitCount,
        int analyzedUnitCount,
        int failedFileCount,
        int exactDuplicateCount,
        int sameTeamDuplicatePerspectiveCount,
        List<ReplayFileAnalysisStatus> files,
        List<AnalysisUnitResult> analyses,
        List<KeyBattleEvent> keyEvents
) {
}
