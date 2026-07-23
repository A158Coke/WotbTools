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

    /**
     * 重复文件（精确重复或同队重复视角）。保留原始处理状态，
     * 通过 {@code relation} 和 {@code analysisIncluded=false} 表达未参与分析。
     *
     * @param fileName       文件名
     * @param originalStatus 文件解析的实际状态（SUCCESS / PARTIAL_SUCCESS），而非 FAILED
     * @param relation       EXACT_DUPLICATE 或 SAME_TEAM_DUPLICATE_PERSPECTIVE
     * @param duplicateOf    被去重指向的原始文件名
     */
    public static ReplayFileAnalysisStatus duplicate(
            String fileName, ReplayProcessingStatus originalStatus,
            ReplayFileRelation relation, String duplicateOf) {
        return new ReplayFileAnalysisStatus(fileName,
                originalStatus, relation,
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
