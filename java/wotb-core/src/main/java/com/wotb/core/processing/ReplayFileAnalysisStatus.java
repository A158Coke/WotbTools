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
            String fileName, ReplayProcessingStatus status,
            BattleCategory category, ReplayAnalysisScope scope,
            String arenaUniqueId, Integer perspectiveTeam,
            int uploadIndex,
            ReplayProcessingCapabilities capabilities) {
        return new ReplayFileAnalysisStatus(fileName, status,
                ReplayFileRelation.PRIMARY_PERSPECTIVE,
                category, scope, arenaUniqueId, perspectiveTeam,
                true, null, uploadIndex, null, capabilities, null);
    }

    public static ReplayFileAnalysisStatus duplicate(
            String fileName, ReplayProcessingStatus originalStatus,
            ReplayFileRelation relation, String duplicateOf,
            int uploadIndex, Integer duplicateOfUploadIndex) {
        return new ReplayFileAnalysisStatus(fileName,
                originalStatus, relation,
                BattleCategory.UNKNOWN, null, null, null,
                false, duplicateOf, uploadIndex, duplicateOfUploadIndex,
                ReplayProcessingCapabilities.NONE, null);
    }

    public static ReplayFileAnalysisStatus failed(
            String fileName, ReplayProcessingError error,
            int uploadIndex) {
        return new ReplayFileAnalysisStatus(fileName,
                ReplayProcessingStatus.FAILED,
                ReplayFileRelation.INDEPENDENT_BATTLE,
                BattleCategory.UNKNOWN, null, null, null,
                false, null, uploadIndex, null,
                ReplayProcessingCapabilities.NONE, error);
    }
}
