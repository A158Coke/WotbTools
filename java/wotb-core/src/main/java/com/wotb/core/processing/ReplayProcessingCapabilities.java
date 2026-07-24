package com.wotb.core.processing;

/**
 * 单个回放"能做什么分析"的能力标记。
 * <p>
 * {@code aiAnalyzable} = 基于权威结算可进行个人分析，不要求 reconstruction 成功。
 * {@code fullFeatureAnalysisAvailable} = 同时具备完整重建特征（位置+实体映射+特征集）。
 * </p>
 */
public record ReplayProcessingCapabilities(
        boolean summaryAvailable,
        boolean recorderResultAvailable,
        boolean reconstructionAvailable,
        boolean recorderEntityMapped,
        boolean perspectiveTeamResolved,
        boolean playerFeatureSetAvailable,
        boolean teamFeatureSetAvailable,
        boolean aiAnalyzable,
        boolean fullFeatureAnalysisAvailable
) {

    public static final ReplayProcessingCapabilities NONE =
            new ReplayProcessingCapabilities(false, false, false, false, false, false, false, false, false);

    /** 仅战绩可用（降级模式）。recorderResultAvailable 按实际情况传入。 */
    public static ReplayProcessingCapabilities summaryOnly(final boolean recorderResultAvailable) {
        return new ReplayProcessingCapabilities(true, recorderResultAvailable, false, false, false, false, false,
                true && recorderResultAvailable, false);
    }

    /**
     * 按分析范围构建，自动计算 aiAnalyzable 与 fullFeatureAnalysisAvailable。
     */
    public static ReplayProcessingCapabilities of(
            boolean summaryAvailable,
            boolean recorderResultAvailable,
            boolean reconstructionAvailable,
            boolean recorderEntityMapped,
            boolean perspectiveTeamResolved,
            boolean playerFeatureSetAvailable,
            boolean teamFeatureSetAvailable,
            ReplayAnalysisScope scope) {

        final boolean aiOk = switch (scope) {
            case PLAYER_FOCUSED -> summaryAvailable && recorderResultAvailable;
            case TEAM_PERSPECTIVE -> summaryAvailable && reconstructionAvailable
                    && perspectiveTeamResolved && teamFeatureSetAvailable;
        };
        final boolean fullFeature = aiOk && reconstructionAvailable
                && recorderEntityMapped && playerFeatureSetAvailable;
        return new ReplayProcessingCapabilities(
                summaryAvailable, recorderResultAvailable,
                reconstructionAvailable, recorderEntityMapped,
                perspectiveTeamResolved,
                playerFeatureSetAvailable, teamFeatureSetAvailable,
                aiOk, fullFeature);
    }
}
