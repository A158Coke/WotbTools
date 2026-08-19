package com.wotb.core.ai;

/**
 * 计划结果，包含最终用户内容、估算 token 数和密度级别。
 *
 * @param userContent          最终用户消息内容（含 base + 附加证据）
 * @param estimatedInputTokens 估算的总输入 token 数（system + user）
 * @param effectiveInputLimit  实际可用输入上限（含安全余量后的值）
 * @param density              实际达到的证据密度级别
 * @param truncated            是否因超限而被截断
 * @param budgetSummary        预算摘要描述（便于日志和调试）
 */
public record PlannedPrompt(
        String userContent,
        int estimatedInputTokens,
        int effectiveInputLimit,
        EvidenceDensity density,
        boolean truncated,
        String budgetSummary
) {
}
