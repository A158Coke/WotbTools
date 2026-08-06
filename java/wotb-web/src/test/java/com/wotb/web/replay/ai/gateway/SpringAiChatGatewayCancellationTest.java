package com.wotb.web.replay.ai.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.metadata.ChatGenerationMetadata;
import org.springframework.ai.chat.metadata.ChatResponseMetadata;
import org.springframework.ai.chat.metadata.DefaultUsage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;

/**
 * Verifies that a client abort (via {@link AiRequestContext} + cancellation
 * token) stops the retry loop and never records success or usage: the whole
 * point is to avoid paying for a response nobody waits for.
 */
class SpringAiChatGatewayCancellationTest {

    private static final long START_NANOS = 1_000_000_000_000L;

    private final AtomicLong now = new AtomicLong(START_NANOS);
    private ChatModel chatModel;
    private SimpleMeterRegistry registry;
    private SpringAiChatGateway gateway;
    private AiCancellationToken cancellation;

    @BeforeEach
    void setUp() {
        chatModel = mock(ChatModel.class);
        registry = new SimpleMeterRegistry();
        gateway = new SpringAiChatGateway(chatModel, "test-model", registry,
                new AiRetryPolicy(3, 1000, 8000, 2.0),
                315_000_000_000L, now::get, millis -> {
                });
        cancellation = new AiCancellationToken();
        AiRequestContext.set("corr-cancel", cancellation);
    }

    @AfterEach
    void tearDown() {
        AiRequestContext.clear();
    }

    @Test
    void cancelBeforeAttemptStopsWithoutSendingAnyRequest() {
        cancellation.cancel();

        final AiUpstreamException e =
                assertThrows(AiUpstreamException.class, () -> gateway.chat(request()));

        assertEquals("AI_CANCELLED", e.code());
        verify(chatModel, never()).call(any(Prompt.class));
        assertEquals(0L, counter("wotb_ai_upstream_requests_total", "mode", "TEST_MODE"));
        assertEquals(0L, counter("wotb_ai_upstream_retries_total", "mode", "TEST_MODE"));
        assertEquals(1L, counter("wotb_ai_upstream_errors_total", "type", "AI_CANCELLED"));
    }

    @Test
    void cancelDuringAttemptStopsRetryLoopEvenForRetryableFailure() {
        when(chatModel.call(any(Prompt.class))).thenThrow(upstream("AI_RATE_LIMITED", 429));
        gateway.attemptStartHook = context -> cancellation.cancel();

        final AiUpstreamException e =
                assertThrows(AiUpstreamException.class, () -> gateway.chat(request()));

        assertEquals("AI_CANCELLED", e.code());
        assertEquals(1L, counter("wotb_ai_upstream_requests_total", "mode", "TEST_MODE"));
        assertEquals(0L, counter("wotb_ai_upstream_retries_total", "mode", "TEST_MODE"),
                "client abort must never trigger a retry");
        assertEquals(1L, counter("wotb_ai_upstream_errors_total", "type", "AI_CANCELLED"));
    }

    @Test
    void cancelDuringResponseConversionNeverRecordsSuccessOrUsage() {
        when(chatModel.call(any(Prompt.class))).thenReturn(okResponse());
        gateway.attemptStartHook = context -> cancellation.cancel();

        final AiUpstreamException e =
                assertThrows(AiUpstreamException.class, () -> gateway.chat(request()));

        assertEquals("AI_CANCELLED", e.code());
        assertEquals(1L, counter("wotb_ai_upstream_requests_total", "mode", "TEST_MODE"));
        assertEquals(0L, counter("wotb_ai_upstream_success_total", "mode", "TEST_MODE"));
        assertEquals(0L, counter("wotb_ai_upstream_tokens_total", "mode", "TEST_MODE"));
        assertEquals(1L, counter("wotb_ai_upstream_errors_total", "type", "AI_CANCELLED"));
        assertEquals(1L, counter("wotb_ai_upstream_retry_outcome_total", "outcome", "no_retry"));
    }

    @Test
    void registryCancelsOnlyRegisteredRequests() {
        final AiCancellationRegistry registry = new AiCancellationRegistry();
        final AiCancellationToken token = registry.register("abc");
        assertTrue(registry.cancel("abc"));
        assertTrue(token.isCancelled());
        // idempotent: cancelling again still reports the request as registered
        assertTrue(registry.cancel("abc"));
        registry.unregister("abc");
        assertTrue(!registry.cancel("abc"));
        assertTrue(!registry.cancel("never-registered"));
    }

    private static AiUpstreamException upstream(final String code, final Integer status) {
        return new AiUpstreamException(code, status, "corr-cancel");
    }

    private static AiChatRequest request() {
        return new AiChatRequest("system-prompt", "user-prompt",
                "test-model", null, 4096, true, "max",
                "corr-cancel", "TEST_MODE");
    }

    private long counter(final String name, final String... tags) {
        final Counter counter = registry.find(name).tags(tags).counter();
        return counter != null ? (long) counter.count() : 0L;
    }

    private static ChatResponse okResponse() {
        final Generation generation = new Generation(
                new AssistantMessage("ok"),
                ChatGenerationMetadata.builder().finishReason("stop").build());
        return ChatResponse.builder()
                .generations(List.of(generation))
                .metadata(ChatResponseMetadata.builder()
                        .model("test-model")
                        .usage(new DefaultUsage(1, 1, 2))
                        .build())
                .build();
    }
}
