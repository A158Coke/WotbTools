package com.wotb.web.replay.ai;

import java.util.List;
import java.util.Map;

import com.wotb.core.ai.AiTokenEstimator;

/**
 * Token / context 预算的唯一事实来源。
 * <p>所有 Player/Team 编排与 Gateway 调用前都必须通过本组件检查，
 * 避免三套重复的 {@code estimated > max} 判断与各自抛出的稳定错误码。</p>
 * <ul>
 *   <li>Layer 1: estimated input tokens 不得超过 {@code singleReplayMaxInputTokens}</li>
 *   <li>Layer 2: input + max output + safety margin 必须放进 {@code contextWindowTokens}</li>
 * </ul>
 * 拒绝时抛 {@link IllegalArgumentException}，携带稳定错误码
 * {@code AI_TOKEN_BUDGET_EXCEEDED} / {@code AI_CONTEXT_WINDOW_EXCEEDED}。
 */
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

    /**
     * 用给定 estimator 估算 messages token 后执行 {@link #enforce}。
     */
    public static void enforceMessages(final AiTokenEstimator estimator,
                                       final List<Map<String, Object>> messages,
                                       final int singleReplayMaxInputTokens,
                                       final int contextWindowTokens,
                                       final int maxOutputTokens,
                                       final int promptSafetyMarginTokens) {
        enforce(estimator.estimateMessagesTokens(messages),
                singleReplayMaxInputTokens, contextWindowTokens,
                maxOutputTokens, promptSafetyMarginTokens);
    }
}