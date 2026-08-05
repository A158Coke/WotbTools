package com.wotb.web.replay.ai;

import com.wotb.core.ai.AiTokenEstimator;

/**
 * Player/Team AI 编排共享的预算与模型选项配置。
 * <p>由 Spring 配置装配一次，注入 {@link PlayerReplayAnalysisService}、
 * {@link TeamReplayAnalysisService} 与兼容 facade；避免在多个 Service 间
 * 重复持有预算字段或重复预算检查。预算合法性已在
 * {@link com.wotb.web.config.AiModelProperties} 的构造校验中处理；本 record 仅做
 * 非空与基础下限检查，不重复总预算断言。</p>
 */
public record AiReplayAnalysisConfig(
        AiTokenEstimator estimator,
        String model,
        int singleReplayMaxInputTokens,
        int contextWindowTokens,
        int maxOutputTokens,
        int promptSafetyMarginTokens,
        boolean thinkingEnabled,
        String reasoningEffort
) {
    public AiReplayAnalysisConfig {
        if (estimator == null) throw new IllegalArgumentException("estimator must not be null");
        if (model == null) throw new IllegalArgumentException("model must not be null");
        if (promptSafetyMarginTokens < 0) {
            throw new IllegalArgumentException("promptSafetyMarginTokens must be >= 0");
        }
        if (contextWindowTokens <= 0) {
            throw new IllegalArgumentException("contextWindowTokens must be > 0");
        }
        if (maxOutputTokens < 0) {
            throw new IllegalArgumentException("maxOutputTokens must be >= 0");
        }
    }
}