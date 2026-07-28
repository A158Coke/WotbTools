package com.wotb.web.config;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;
import jakarta.validation.constraints.Positive;

@ConfigurationProperties(prefix = "wotb.ai")
@Validated
public record AiModelProperties(
        String apiKey,
        String baseUrl,
        String model,
        @Positive int timeoutSec,
        @Positive int contextWindowTokens,
        @Positive int singlePlayerMaxInputTokens,
        @Positive int maxOutputTokens,
        int promptSafetyMarginTokens,
        boolean thinkingEnabled,
        String reasoningEffort
) {
    public AiModelProperties {
        if (promptSafetyMarginTokens < 0) throw new IllegalArgumentException("promptSafetyMarginTokens must be >= 0");
        if (singlePlayerMaxInputTokens + maxOutputTokens + promptSafetyMarginTokens > contextWindowTokens) {
            throw new IllegalArgumentException(
                "Budget exceeds context window: " + singlePlayerMaxInputTokens + " + " + maxOutputTokens
                + " + " + promptSafetyMarginTokens + " > " + contextWindowTokens);
        }
        if (thinkingEnabled && !"high".equals(reasoningEffort) && !"max".equals(reasoningEffort)) {
            throw new IllegalArgumentException("reasoningEffort must be 'high' or 'max' when thinking is enabled: " + reasoningEffort);
        }
    }
}
