package com.wotb.core.processing;

/**
 * 单个回放"能做什么分析"的能力标记。
 * <p>
 * 用于替代"只看 SUCCESS/PARTIAL_SUCCESS 就当作可 AI 分析"的粗略判断：
 * AI 战术复盘以 {@code battle_results.dat}（结算数据）为权威源，因此
 * {@link #aiAnalyzable} 取决于战绩是否解析成功，而不取决于完整重建是否成功。
 * 完整重建只影响位置/走位维度（{@link #reconstructionAvailable}）。
 * </p>
 *
 * @param summaryAvailable        战绩（Battle）是否可用
 * @param reconstructionAvailable 完整重建（位置/时间线）是否可用
 * @param aiAnalyzable            是否可进行 AI 分析（等价于战绩可用）
 */
public record ReplayProcessingCapabilities(
        boolean summaryAvailable,
        boolean reconstructionAvailable,
        boolean aiAnalyzable
) {

    /** 什么都不可用（解析失败/重复文件）。 */
    public static final ReplayProcessingCapabilities NONE =
            new ReplayProcessingCapabilities(false, false, false);

    /**
     * 以战绩为权威源构建能力标记。
     *
     * @param summaryAvailable        战绩是否可用
     * @param reconstructionAvailable 重建是否可用
     */
    public static ReplayProcessingCapabilities of(boolean summaryAvailable,
                                                  boolean reconstructionAvailable) {
        return new ReplayProcessingCapabilities(
                summaryAvailable, reconstructionAvailable, summaryAvailable);
    }
}
