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

    /**
     * 终态 AI_TIMEOUT / AI_CANCELLED 重新分类时显式传 null：不得从 cause chain
     * 继承之前的 provider response，否则会把旧 402/500 误标成最终失败状态。
     */
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
