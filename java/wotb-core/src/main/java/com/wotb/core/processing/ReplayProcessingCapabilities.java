package com.wotb.core.processing;

/**
 * 单个回放"能做什么分析"的能力标记。
 * aiAnalyzable 按分析范围分别计算。
 */
public record ReplayProcessingCapabilities(
        boolean summaryAvailable,
        boolean reconstructionAvailable,
        boolean recorderMapped,
        boolean perspectiveTeamResolved,
        boolean playerFeatureSetAvailable,
        boolean teamFeatureSetAvailable,
        boolean aiAnalyzable
) {

    public static final ReplayProcessingCapabilities NONE =
            new ReplayProcessingCapabilities(false, false, false, false, false, false, false);

    /** 仅战绩可用（降级模式）。 */
    public static ReplayProcessingCapabilities summaryOnly() {
        return new ReplayProcessingCapabilities(true, false, false, false, false, false, false);
    }

    /**
     * 按分析范围构建，自动计算 aiAnalyzable。
     */
    public static ReplayProcessingCapabilities of(
            boolean summaryAvailable,
            boolean reconstructionAvailable,
            boolean recorderMapped,
            boolean perspectiveTeamResolved,
            boolean playerFeatureSetAvailable,
            boolean teamFeatureSetAvailable,
            ReplayAnalysisScope scope) {

        final boolean aiOk = switch (scope) {
            case PLAYER_FOCUSED -> summaryAvailable && reconstructionAvailable
                    && recorderMapped && playerFeatureSetAvailable;
            case TEAM_PERSPECTIVE -> summaryAvailable && reconstructionAvailable
                    && perspectiveTeamResolved && teamFeatureSetAvailable;
        };
        return new ReplayProcessingCapabilities(
                summaryAvailable, reconstructionAvailable,
                recorderMapped, perspectiveTeamResolved,
                playerFeatureSetAvailable, teamFeatureSetAvailable,
                aiOk);
    }
}
