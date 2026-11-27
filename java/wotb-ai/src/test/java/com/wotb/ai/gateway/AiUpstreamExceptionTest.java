package com.wotb.ai.gateway;

import com.openai.core.http.Headers;
import com.openai.errors.UnexpectedStatusCodeException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

class AiUpstreamExceptionTest {

    @Test
    void keepsExplicitProviderStatus() {
        final AiUpstreamException error = new AiUpstreamException(
                "AI_UPSTREAM_UNAVAILABLE", 402, "corr-402");

        assertEquals(402, error.providerStatus());
    }

    @Test
    void doesNotInferProviderStatusFromCauseChain() {
        final UnexpectedStatusCodeException providerError = UnexpectedStatusCodeException.builder()
                .statusCode(402)
                .headers(Headers.builder().build())
                .build();
        final RuntimeException springWrapper = new IllegalStateException("wrapped provider failure", providerError);
        final AiUpstreamException providerFailure = new AiUpstreamException(
                "AI_UPSTREAM_UNAVAILABLE", 402, "corr-402", springWrapper);

        final AiUpstreamException terminalTimeout = new AiUpstreamException(
                "AI_TIMEOUT", null, "corr-timeout", providerFailure);

        assertNull(terminalTimeout.providerStatus());
    }
}
