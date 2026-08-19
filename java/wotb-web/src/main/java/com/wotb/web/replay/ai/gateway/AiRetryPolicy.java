package com.wotb.web.replay.ai.gateway;

import com.wotb.web.config.AiModelProperties;

/**
 * The single AI upstream retry policy, executed inside
 * {@link SpringAiChatGateway}. The SDK itself keeps {@code maxRetries} at 0,
 * so there is no retry multiplication (retry x retry).
 *
 * <p>Retryable: 429, connection failures, and AI_UPSTREAM_UNAVAILABLE with no
 * status or with 500/502/503/504.</p>
 *
 * <p>Never retried: read/response timeouts (AI_TIMEOUT - the upstream may have
 * already processed and billed the request, so a retry would double-charge),
 * authentication/permission failures, invalid request, model not found,
 * context too large, and empty/invalid completions (avoids paying twice for an
 * already billed response).</p>
 */
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

    /**
     * Wait time for the {@code retryNumber}-th retry (1-based), exponential
     * (base * multiplier^(n-1)) and capped at {@code maxBackoffMillis}.
     */
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

    /**
     * The single retryable check, aligned with the gateway's stable error codes.
     */
    public boolean isRetryable(final AiUpstreamException error) {
        if (error == null) {
            return false;
        }
        return switch (error.code()) {
            case "AI_RATE_LIMITED" -> true;
            case "AI_UPSTREAM_UNAVAILABLE" -> error.providerStatus() == null || retryableStatus(error.providerStatus());
            default -> false;
        };
    }

    private static boolean retryableStatus(final int status) {
        return status == 500 || status == 502 || status == 503 || status == 504;
    }
}
