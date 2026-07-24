package com.wotb.core.processing;

/**
 * 单个回放"能做什么分析"的能力标记（纯事实，scope-independent）。
 * <p>
 * scope 可分析规则在 BatchAnalyzer.isAiAnalyzable() 中统一计算，
 * 不在本 record 中预计算。
 * </p>
 */
public record ReplayProcessingCapabilities(
        boolean summaryAvailable,
        boolean recorderResultAvailable,
        boolean reconstructionAvailable,
        boolean recorderParticipantResolved,
        boolean recorderEntityMapped,
        boolean perspectiveTeamResolved,
        boolean playerFeatureExtractionPossible,
        boolean teamFeatureExtractionPossible
) {

    public static final ReplayProcessingCapabilities NONE =
            new ReplayProcessingCapabilities(false, false, false, false, false, false, false, false);

    /** 仅战绩可用（降级模式）。recorderResultAvailable 按实际情况传入。 */
    public static ReplayProcessingCapabilities summaryOnly(final boolean recorderResultAvailable) {
        return new ReplayProcessingCapabilities(true, recorderResultAvailable, false, false, false, false, false, false);
    }
}
