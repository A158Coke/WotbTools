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
        @Positive int singleReplayMaxInputTokens,
        @Positive int maxOutputTokens,
        int promptSafetyMarginTokens,
        boolean thinkingEnabled,
        String reasoningEffort
) {
    public AiModelProperties {
        if (promptSafetyMarginTokens < 0) throw new IllegalArgumentException("promptSafetyMarginTokens must be >= 0");
        final long totalReserved = (long) singleReplayMaxInputTokens + maxOutputTokens + promptSafetyMarginTokens;
        if (totalReserved > (long) contextWindowTokens) {
            throw new IllegalArgumentException(
                "Total budget exceeds context window: " + singleReplayMaxInputTokens + " + " + maxOutputTokens
                + " + " + promptSafetyMarginTokens + " = " + totalReserved + " > " + contextWindowTokens);
        }
        if (thinkingEnabled && !"high".equals(reasoningEffort) && !"max".equals(reasoningEffort)) {
            throw new IllegalArgumentException("reasoningEffort must be 'high' or 'max' when thinking is enabled: " + reasoningEffort);
        }
    }
}
