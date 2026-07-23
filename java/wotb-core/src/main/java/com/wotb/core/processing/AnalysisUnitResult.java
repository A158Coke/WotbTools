package com.wotb.core.processing;

import java.util.List;

/**
 * AI 分析中一个分析单元的结果。
 */
public record AnalysisUnitResult(
        String analysisUnitId,
        BattleIdentity battleIdentity,
        ReplayAnalysisScope scope,
        Integer perspectiveTeam,
        String representativeFileName,
        List<String> duplicateFileNames,
        String model,
        Object report
) {
}
