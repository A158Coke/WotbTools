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
        @Positive int connectTimeoutSec,
        @Positive int timeoutSec,
        @Positive int callTimeoutSec,
        @Positive int retryMaxAttempts,
        long retryInitialBackoffMillis,
        long retryMaxBackoffMillis,
        double retryBackoffMultiplier,
        @Positive int contextWindowTokens,
        @Positive int singleReplayMaxInputTokens,
        @Positive int maxOutputTokens,
        int promptSafetyMarginTokens,
        boolean thinkingEnabled,
        String reasoningEffort,
        boolean call2ThinkingEnabled,
        @Positive int teamReviewMaxOutputTokens
) {
    public AiModelProperties {
        if (connectTimeoutSec < 1 || connectTimeoutSec > 3600) {
            throw new IllegalArgumentException(
                    "connectTimeoutSec must be in [1, 3600]: " + connectTimeoutSec);
        }
        if (timeoutSec < 1 || timeoutSec > 3600) {
            throw new IllegalArgumentException(
                    "timeoutSec must be in [1, 3600]: " + timeoutSec);
        }
        if (callTimeoutSec < 1 || callTimeoutSec > 3600) {
            throw new IllegalArgumentException(
                    "callTimeoutSec must be in [1, 3600]: " + callTimeoutSec);
        }
        if (callTimeoutSec < connectTimeoutSec + timeoutSec) {
            throw new IllegalArgumentException(
                    "callTimeoutSec must cover connect + read timeouts: "
                            + callTimeoutSec + " < " + connectTimeoutSec + " + " + timeoutSec);
        }
        if (retryMaxAttempts < 1 || retryMaxAttempts > 5) {
            throw new IllegalArgumentException(
                    "retryMaxAttempts must be in [1, 5]: " + retryMaxAttempts);
        }
        if (retryInitialBackoffMillis < 0 || retryInitialBackoffMillis > 60_000) {
            throw new IllegalArgumentException(
                    "retryInitialBackoffMillis must be in [0, 60000]: " + retryInitialBackoffMillis);
        }
        if (retryMaxBackoffMillis < retryInitialBackoffMillis || retryMaxBackoffMillis > 300_000) {
            throw new IllegalArgumentException(
                    "retryMaxBackoffMillis must be in [initialBackoff, 300000]: " + retryMaxBackoffMillis);
        }
        if (retryBackoffMultiplier < 1.0) {
            throw new IllegalArgumentException(
                    "retryBackoffMultiplier must be >= 1.0: " + retryBackoffMultiplier);
        }
        if (promptSafetyMarginTokens < 0) throw new IllegalArgumentException("promptSafetyMarginTokens must be >= 0");
        final long totalReserved = (long) singleReplayMaxInputTokens + maxOutputTokens + promptSafetyMarginTokens;
        if (totalReserved > (long) contextWindowTokens) {
            throw new IllegalArgumentException(
                "Total budget exceeds context window: " + singleReplayMaxInputTokens + " + " + maxOutputTokens
                + " + " + promptSafetyMarginTokens + " = " + totalReserved + " > " + contextWindowTokens);
        }
        if ((thinkingEnabled || call2ThinkingEnabled)
                && !"high".equals(reasoningEffort) && !"max".equals(reasoningEffort)) {
            throw new IllegalArgumentException("reasoningEffort must be 'high' or 'max' when thinking is enabled: " + reasoningEffort);
        }
    }
}
