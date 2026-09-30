package com.wotb.web.replay.ai.gateway;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AiRetryPolicyTest {

    @Test
    void validatesBounds() {
        assertThrows(IllegalArgumentException.class,
                () -> new AiRetryPolicy(0, 1000, 8000, 2.0));
        assertThrows(IllegalArgumentException.class,
                () -> new AiRetryPolicy(6, 1000, 8000, 2.0));
        assertThrows(IllegalArgumentException.class,
                () -> new AiRetryPolicy(3, -1, 8000, 2.0));
        assertThrows(IllegalArgumentException.class,
                () -> new AiRetryPolicy(3, 5000, 4000, 2.0));
        assertThrows(IllegalArgumentException.class,
                () -> new AiRetryPolicy(3, 1000, 8000, 0.5));
    }

    @Test
    void computesCappedExponentialBackoff() {
        final AiRetryPolicy policy = new AiRetryPolicy(5, 1000, 8000, 2.0);
        assertEquals(1000, policy.backoffMillis(1));
        assertEquals(2000, policy.backoffMillis(2));
        assertEquals(4000, policy.backoffMillis(3));
        assertEquals(8000, policy.backoffMillis(4));
        assertEquals(8000, policy.backoffMillis(5));
        assertThrows(IllegalArgumentException.class, () -> policy.backoffMillis(0));
    }

    @Test
    void zeroBackoffIsAllowedForTests() {
        final AiRetryPolicy policy = new AiRetryPolicy(3, 0, 0, 2.0);
        assertEquals(0, policy.backoffMillis(1));
        assertEquals(0, policy.backoffMillis(2));
    }

    @Test
    void retryableErrors() {
        final AiRetryPolicy policy = new AiRetryPolicy(3, 1000, 8000, 2.0);
        assertTrue(policy.isRetryable(upstream("AI_RATE_LIMITED", 429)));
        assertTrue(policy.isRetryable(upstream("AI_UPSTREAM_UNAVAILABLE", null)));
        assertTrue(policy.isRetryable(upstream("AI_UPSTREAM_UNAVAILABLE", 500)));
        assertTrue(policy.isRetryable(upstream("AI_UPSTREAM_UNAVAILABLE", 502)));
        assertTrue(policy.isRetryable(upstream("AI_UPSTREAM_UNAVAILABLE", 503)));
        assertTrue(policy.isRetryable(upstream("AI_UPSTREAM_UNAVAILABLE", 504)));
    }

    @Test
    void nonRetryableErrors() {
        final AiRetryPolicy policy = new AiRetryPolicy(3, 1000, 8000, 2.0);
        assertFalse(policy.isRetryable(upstream("AI_AUTHENTICATION_ERROR", 401)));
        assertFalse(policy.isRetryable(upstream("AI_AUTHENTICATION_ERROR", 403)));
        assertFalse(policy.isRetryable(upstream("AI_INVALID_REQUEST", 400)));
        assertFalse(policy.isRetryable(upstream("AI_INVALID_REQUEST", 404)));
        assertFalse(policy.isRetryable(upstream("AI_CONTEXT_TOO_LARGE", 413)));
        assertFalse(policy.isRetryable(upstream("AI_EMPTY_RESPONSE", null)));
        assertFalse(policy.isRetryable(upstream("AI_RESPONSE_INVALID", null)));
        // A timed-out request may already have been processed and billed
        // upstream; retrying it would double-charge.
        assertFalse(policy.isRetryable(upstream("AI_TIMEOUT", 408)));
        assertFalse(policy.isRetryable(upstream("AI_TIMEOUT", null)));
        assertFalse(policy.isRetryable(upstream("AI_CANCELLED", null)));
        assertFalse(policy.isRetryable(upstream("AI_UPSTREAM_UNAVAILABLE", 501)));
        assertFalse(policy.isRetryable(upstream("AI_UPSTREAM_UNAVAILABLE", 505)));
        assertFalse(policy.isRetryable(null));
    }

    private static AiUpstreamException upstream(final String code, final Integer status) {
        return new AiUpstreamException(code, status, "corr");
    }
}
