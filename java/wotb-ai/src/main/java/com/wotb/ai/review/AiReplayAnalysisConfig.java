package com.wotb.ai.review;

import com.wotb.core.ai.AiTokenEstimator;

public record AiReplayAnalysisConfig(
        AiTokenEstimator estimator,
        String model,
        int singleReplayMaxInputTokens,
        int contextWindowTokens,
        int maxOutputTokens,
        int promptSafetyMarginTokens,
        boolean call2ThinkingEnabled,
        String reasoningEffort,
        int callTimeoutSec,
        int teamReviewMaxOutputTokens
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
        if (teamReviewMaxOutputTokens <= 0) {
            throw new IllegalArgumentException("teamReviewMaxOutputTokens must be > 0");
        }
        if (callTimeoutSec <= 0) {
            throw new IllegalArgumentException("callTimeoutSec must be > 0");
        }
    }
}
