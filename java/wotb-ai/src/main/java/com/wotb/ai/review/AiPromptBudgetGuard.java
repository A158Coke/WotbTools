package com.wotb.ai.review;

public final class AiPromptBudgetGuard {

    private AiPromptBudgetGuard() {
    }

    /**
     * 检查估算的输入 token 是否满足两层预算。
     *
     * @param estimatedTokens           已估算的输入 token 数
     * @param singleReplayMaxInputTokens 单回放最大输入 token 上限
     * @param contextWindowTokens       模型上下文窗口
     * @param maxOutputTokens           最大输出 token 预留
     * @param promptSafetyMarginTokens  安全余量
     */
    public static void enforce(final int estimatedTokens,
                               final int singleReplayMaxInputTokens,
                               final int contextWindowTokens,
                               final int maxOutputTokens,
                               final int promptSafetyMarginTokens) {
        if (estimatedTokens > singleReplayMaxInputTokens) {
            throw new IllegalArgumentException(
                    "AI_TOKEN_BUDGET_EXCEEDED: estimatedInputTokens=" + estimatedTokens
                            + " > singleReplayMaxInputTokens=" + singleReplayMaxInputTokens);
        }
        final int budget = contextWindowTokens - promptSafetyMarginTokens - maxOutputTokens;
        if (estimatedTokens > budget) {
            throw new IllegalArgumentException(
                    "AI_CONTEXT_WINDOW_EXCEEDED: estimatedInputTokens=" + estimatedTokens
                            + " + maxOutputTokens=" + maxOutputTokens
                            + " + promptSafetyMarginTokens=" + promptSafetyMarginTokens
                            + " > contextWindow=" + contextWindowTokens);
        }
    }

}
