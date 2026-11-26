package com.wotb.ai.gateway;

import com.wotb.ai.config.AiModelProperties;

public record AiRetryPolicy(
        int maxAttempts,
        long initialBackoffMillis,
        long maxBackoffMillis,
        double backoffMultiplier
) {

    public static final AiRetryPolicy DEFAULT = new AiRetryPolicy(3, 1000, 8000, 2.0);

    public AiRetryPolicy {
        if (maxAttempts < 1 || maxAttempts > 5) {
            throw new IllegalArgumentException("maxAttempts must be in [1, 5]: " + maxAttempts);
        }
        if (initialBackoffMillis < 0 || initialBackoffMillis > 60_000) {
            throw new IllegalArgumentException(
                    "initialBackoffMillis must be in [0, 60000]: " + initialBackoffMillis);
        }
        if (maxBackoffMillis < initialBackoffMillis || maxBackoffMillis > 300_000) {
            throw new IllegalArgumentException(
                    "maxBackoffMillis must be in [initialBackoffMillis, 300000]: " + maxBackoffMillis);
        }
        if (backoffMultiplier < 1.0) {
            throw new IllegalArgumentException("backoffMultiplier must be >= 1.0: " + backoffMultiplier);
        }
    }

    public static AiRetryPolicy from(final AiModelProperties properties) {
        return new AiRetryPolicy(
                properties.retryMaxAttempts(),
                properties.retryInitialBackoffMillis(),
                properties.retryMaxBackoffMillis(),
                properties.retryBackoffMultiplier());
    }

    public long backoffMillis(final int retryNumber) {
        if (retryNumber < 1) {
            throw new IllegalArgumentException("retryNumber must be >= 1: " + retryNumber);
        }
        final double delay = initialBackoffMillis * Math.pow(backoffMultiplier, retryNumber - 1);
        if (delay >= maxBackoffMillis) {
            return maxBackoffMillis;
        }
        return Math.max(initialBackoffMillis, (long) delay);
    }

    public boolean isRetryable(final AiUpstreamException error) {
        if (error == null) {
            return false;
        }
        return switch (error.code()) {
            case "AI_RATE_LIMITED" -> true;
            case "AI_UPSTREAM_UNAVAILABLE" ->
                    error.providerStatus() == null || retryableStatus(error.providerStatus());
            default -> false;
        };
    }

    private static boolean retryableStatus(final int status) {
        return status == 500 || status == 502 || status == 503 || status == 504;
    }
}
