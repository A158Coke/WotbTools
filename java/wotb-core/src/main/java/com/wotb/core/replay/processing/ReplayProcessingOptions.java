package com.wotb.core.replay.processing;

/**
 * 处理选项，控制每个文件执行哪些步骤。
 * 普通 preview 只需 parseSummary，不承担重建成本。
 */
public record ReplayProcessingOptions(
        boolean parseSummary,
        boolean reconstructTimeline,
        boolean extractFeatures
) {

    /** 仅解析战后数据（当前普通 preview 模式）。 */
    public static ReplayProcessingOptions summaryOnly() {
        return new ReplayProcessingOptions(true, false, false);
    }

    /** 战后数据 + 完整重建（AI 单场分析模式）。 */
    public static ReplayProcessingOptions full() {
        return new ReplayProcessingOptions(true, true, false);
    }

    /**
     * 战后数据 + 完整重建 + 特征提取（AI 深度分析模式）。
     * 当前 AI 服务在构建各自上下文时提取特征；该选项保留给处理门面的统一流水线。
     */
    public static ReplayProcessingOptions fullWithFeatures() {
        return new ReplayProcessingOptions(true, true, true);
    }
}
