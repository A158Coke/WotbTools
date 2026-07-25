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
        int uploadIndex,
        Integer duplicateOfUploadIndex,
        ReplayProcessingCapabilities capabilities,
        ReplayProcessingError error
) {

    public static ReplayFileAnalysisStatus primary(
            final String fileName,
            final ReplayProcessingStatus status,
            final BattleCategory category,
            final ReplayAnalysisScope scope,
            final String arenaUniqueId,
            final Integer perspectiveTeam,
            final boolean analysisIncluded,
            final int uploadIndex,
            final ReplayProcessingCapabilities capabilities
    ) {
        return new ReplayFileAnalysisStatus(fileName, status,
                ReplayFileRelation.PRIMARY_PERSPECTIVE,
                category, scope, arenaUniqueId, perspectiveTeam,
                analysisIncluded, null, uploadIndex, null, capabilities, null);
    }

    public static ReplayFileAnalysisStatus duplicate(
            final String fileName,
            final ReplayProcessingStatus originalStatus,
            final ReplayFileRelation relation,
            final String duplicateOf,
            final int uploadIndex,
            final Integer duplicateOfUploadIndex
    ) {
        return new ReplayFileAnalysisStatus(fileName,
                originalStatus, relation,
                BattleCategory.UNKNOWN, null, null, null,
                false, duplicateOf, uploadIndex, duplicateOfUploadIndex,
                ReplayProcessingCapabilities.NONE, null);
    }

    public static ReplayFileAnalysisStatus failed(
            final String fileName,
            final ReplayProcessingError error,
            final int uploadIndex
    ) {
        return new ReplayFileAnalysisStatus(fileName,
                ReplayProcessingStatus.FAILED,
                ReplayFileRelation.INDEPENDENT_BATTLE,
                BattleCategory.UNKNOWN, null, null, null,
                false, null, uploadIndex, null,
                ReplayProcessingCapabilities.NONE, error);
    }
}
