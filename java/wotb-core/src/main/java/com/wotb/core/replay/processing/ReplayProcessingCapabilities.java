package com.wotb.core.replay.processing;

/**
 * 单个当前 processing result 的事实可用性标记（scope-independent）。
 * <p>这些字段描述已经完成的解析/重建输出，不是 future queue/job status，也不承载研究 probe 结论。</p>
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
