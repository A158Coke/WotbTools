package com.wotb.core.processing;

/**
 * AI 分析响应中每个文件的处理状态（扩展版，支持视角分组）。
 */
public record ReplayFileAnalysisStatus(
        String fileName,
        ReplayProcessingStatus status,
        ReplayFileRelation relation,
        BattleCategory battleCategory,
        ReplayAnalysisScope analysisScope,
        String arenaUniqueId,
        Integer perspectiveTeam,
        boolean analysisIncluded,
        String duplicateOf,
        ReplayProcessingCapabilities capabilities,
        ReplayProcessingError error
) {

    public static ReplayFileAnalysisStatus primary(
            String fileName, ReplayProcessingStatus status,
            BattleCategory category, ReplayAnalysisScope scope,
            String arenaUniqueId, Integer perspectiveTeam,
            ReplayProcessingCapabilities capabilities) {
        return new ReplayFileAnalysisStatus(fileName, status,
                ReplayFileRelation.PRIMARY_PERSPECTIVE,
                category, scope, arenaUniqueId, perspectiveTeam,
                true, null, capabilities, null);
    }

    public static ReplayFileAnalysisStatus duplicate(
            String fileName, ReplayFileRelation relation,
            String duplicateOf) {
        return new ReplayFileAnalysisStatus(fileName,
                ReplayProcessingStatus.FAILED, relation,
                BattleCategory.UNKNOWN, null, null, null,
                false, duplicateOf,
                ReplayProcessingCapabilities.NONE, null);
    }

    public static ReplayFileAnalysisStatus failed(
            String fileName, ReplayProcessingError error) {
        return new ReplayFileAnalysisStatus(fileName,
                ReplayProcessingStatus.FAILED,
                ReplayFileRelation.INDEPENDENT_BATTLE,
                BattleCategory.UNKNOWN, null, null, null,
                false, null,
                ReplayProcessingCapabilities.NONE, error);
    }
}
