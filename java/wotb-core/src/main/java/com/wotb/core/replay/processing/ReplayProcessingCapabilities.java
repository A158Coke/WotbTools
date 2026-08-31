package com.wotb.core.replay.processing;

/**
 * 单个当前 processing result 的事实可用性标记（scope-independent）。
 * <p>这些字段描述已经完成的解析/重建输出，不是 future queue/job status，也不承载研究 probe 结论。</p>
 * <p>
 * scope 可分析规则在 AiAnalysisEligibility.isAiAnalyzable() 中统一计算，
 * 不在本 record 中预计算。
 * </p>
 *
 * <p><b>PR-E capabilities 收敛</b>：只保留真实不可重算/有独立意义的事实标记；可廉价从
 * {@link ReplayProcessingResult}（battle / reconstruction / teamResolution）推导的重复状态
 * （recorderParticipantResolved / recorderEntityMapped / playerFeatureExtractionPossible）已删除，
 * 由消费方按当前 result 对象直接判定。</p>
 */
public record ReplayProcessingCapabilities(
        boolean summaryAvailable,
        boolean recorderResultAvailable,
        boolean reconstructionAvailable,
        boolean perspectiveTeamResolved,
        boolean teamFeatureExtractionPossible
) {

    public static final ReplayProcessingCapabilities NONE =
            new ReplayProcessingCapabilities(false, false, false, false, false);

    /** 仅战绩可用（降级模式）。recorderResultAvailable 按实际情况传入。 */
    public static ReplayProcessingCapabilities summaryOnly(final boolean recorderResultAvailable) {
        return new ReplayProcessingCapabilities(true, recorderResultAvailable, false, false, false);
    }
}
