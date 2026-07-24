package com.wotb.core.processing;

/**
 * 单个回放"能做什么分析"的能力标记（scope-independent 的事实）。
 * <p>
 * {@code playerFeatureExtractionPossible} = 具备尝试提取个人特征的前置条件
 * （reconstruction 成功 + entity 映射），不代表特征已提取或 hasFeatures=true。
 * {@code aiAnalyzable} = 按 scope 统一计算，见 BatchAnalyzer.isAiAnalyzable()。
 * {@code fullFeatureAnalysisPossible} = 可进行完整特征分析的潜力。
 * </p>
 */
public record ReplayProcessingCapabilities(
        boolean summaryAvailable,
        boolean recorderResultAvailable,
        boolean reconstructionAvailable,
        boolean recorderEntityMapped,
        boolean perspectiveTeamResolved,
        boolean playerFeatureExtractionPossible,
        boolean teamFeatureExtractionPossible,
        boolean aiAnalyzable,
        boolean fullFeatureAnalysisPossible
) {

    public static final ReplayProcessingCapabilities NONE =
            new ReplayProcessingCapabilities(false, false, false, false, false, false, false, false, false);

    /** 仅战绩可用（降级模式）。recorderResultAvailable 按实际情况传入。 */
    public static ReplayProcessingCapabilities summaryOnly(final boolean recorderResultAvailable) {
        return new ReplayProcessingCapabilities(true, recorderResultAvailable, false, false, false, false, false,
                true && recorderResultAvailable, false);
    }

    /**
     * 按分析范围构建，自动计算 aiAnalyzable 与 fullFeatureAnalysisPossible。
     */
    public static ReplayProcessingCapabilities of(
            boolean summaryAvailable,
            boolean recorderResultAvailable,
            boolean reconstructionAvailable,
            boolean recorderEntityMapped,
            boolean perspectiveTeamResolved,
            boolean playerFeatureExtractionPossible,
            boolean teamFeatureExtractionPossible,
            ReplayAnalysisScope scope) {

        final boolean aiOk = switch (scope) {
            case PLAYER_FOCUSED -> summaryAvailable && recorderResultAvailable;
            case TEAM_PERSPECTIVE -> summaryAvailable && reconstructionAvailable
                    && perspectiveTeamResolved && teamFeatureExtractionPossible;
        };
        final boolean fullFeature = aiOk && reconstructionAvailable
                && recorderEntityMapped && playerFeatureExtractionPossible;
        return new ReplayProcessingCapabilities(
                summaryAvailable, recorderResultAvailable,
                reconstructionAvailable, recorderEntityMapped,
                perspectiveTeamResolved,
                playerFeatureExtractionPossible, teamFeatureExtractionPossible,
                aiOk, fullFeature);
    }
}
