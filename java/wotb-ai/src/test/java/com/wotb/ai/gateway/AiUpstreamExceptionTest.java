package com.wotb.ai.gateway;

import com.openai.core.http.Headers;
import com.openai.errors.UnexpectedStatusCodeException;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class AiUpstreamExceptionTest {

    @Test
    void preservesProviderStatusFromWrappedOpenAiServiceException() {
        final UnexpectedStatusCodeException providerError = UnexpectedStatusCodeException.builder()
                .statusCode(402)
                .headers(Headers.builder().build())
                .build();
        final RuntimeException springWrapper = new IllegalStateException("wrapped provider failure", providerError);

        final AiUpstreamException error = new AiUpstreamException(
                "AI_UPSTREAM_UNAVAILABLE", null, "corr-402", springWrapper);

        assertEquals(402, error.providerStatus());
    }

    @Test
    void explicitProviderStatusTakesPrecedenceOverNestedStatus() {
        final UnexpectedStatusCodeException providerError = UnexpectedStatusCodeException.builder()
                .statusCode(402)
                .headers(Headers.builder().build())
                .build();

        final AiUpstreamException error = new AiUpstreamException(
                "AI_UPSTREAM_UNAVAILABLE", 503, "corr-explicit", providerError);

        assertEquals(503, error.providerStatus());
    }
}
