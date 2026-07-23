package com.wotb.core.processing;

/**
 * 单个回放"能做什么分析"的能力标记。
 *
 * @param summaryAvailable        战绩（Battle）是否可用
 * @param reconstructionAvailable 完整重建（位置/时间线）是否可用
 * @param recorderMapped          录像者实体是否已识别
 * @param featureSetAvailable     战术特征是否已提取
 * @param aiAnalyzable            是否可进行完整 AI 战术复盘
 */
public record ReplayProcessingCapabilities(
        boolean summaryAvailable,
        boolean reconstructionAvailable,
        boolean recorderMapped,
        boolean featureSetAvailable,
        boolean aiAnalyzable
) {

    public static final ReplayProcessingCapabilities NONE =
            new ReplayProcessingCapabilities(false, false, false, false, false);

    /**
     * 以战绩为权威源构建，自动计算 aiAnalyzable。
     */
    public static ReplayProcessingCapabilities of(
            boolean summaryAvailable,
            boolean reconstructionAvailable,
            boolean recorderMapped,
            boolean featureSetAvailable) {
        final boolean aiOk = summaryAvailable
                && reconstructionAvailable
                && recorderMapped
                && featureSetAvailable;
        return new ReplayProcessingCapabilities(
                summaryAvailable, reconstructionAvailable,
                recorderMapped, featureSetAvailable, aiOk);
    }

    /** 仅战绩可用（降级模式，AI 只能做总结，不能做个人复盘）。 */
    public static ReplayProcessingCapabilities summaryOnly() {
        return new ReplayProcessingCapabilities(true, false, false, false, false);
    }
}
