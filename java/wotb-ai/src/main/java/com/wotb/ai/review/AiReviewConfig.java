package com.wotb.ai.review;

import com.wotb.ai.config.AiModelProperties;
import com.wotb.core.ai.AiTokenEstimator;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class AiReviewConfig {

    @Bean
    public AiReplayAnalysisConfig aiReplayAnalysisConfig(final AiModelProperties properties,
                                                         final AiTokenEstimator tokenEstimator) {
        return new AiReplayAnalysisConfig(
                tokenEstimator,
                properties.model(),
                properties.singleReplayMaxInputTokens(),
                properties.contextWindowTokens(),
                properties.maxOutputTokens(),
                properties.promptSafetyMarginTokens(),
                properties.call2ThinkingEnabled(),
                properties.reasoningEffort(),
                properties.callTimeoutSec(),
                properties.teamReviewMaxOutputTokens());
    }
}
