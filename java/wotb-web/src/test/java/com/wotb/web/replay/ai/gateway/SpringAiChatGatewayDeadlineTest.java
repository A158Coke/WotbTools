package com.wotb.web.replay.ai.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicLong;

import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
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
 * Deterministic total-deadline tests: a fake monotonic clock and a fake
 * sleeper verify that {@code AI_CALL_TIMEOUT_SEC} bounds the whole
 * {@code AiChatGateway.chat()} lifecycle (attempts + retries + backoff),
 * without waiting for real time and without calling a real provider.
 */
class SpringAiChatGatewayDeadlineTest {

    private static final long START_NANOS = 1_000_000_000_000L;

    private final AtomicLong now = new AtomicLong(START_NANOS);
    private final List<Long> sleeps = new ArrayList<>();
    private ChatModel chatModel;
    private SimpleMeterRegistry registry;
    private SpringAiChatGateway gateway;

    @BeforeEach
    void setUp() {
        chatModel = mock(ChatModel.class);
        registry = new SimpleMeterRegistry();
    }

    @Test
    void firstAttemptSucceedsImmediately() {
        gateway(315, new AiRetryPolicy(3, 1000, 8000, 2.0));
        when(chatModel.call(any(Prompt.class))).thenReturn(okResponse());

        final AiChatResponse result = gateway.chat(request());

        assertEquals("ok", result.completionText());
        assertEquals(1L, counter("wotb_ai_upstream_requests_total", "mode", "TEST_MODE"));
        assertEquals(1L, counter("wotb_ai_upstream_success_total", "mode", "TEST_MODE"));
        assertEquals(1L, counter("wotb_ai_upstream_retry_outcome_total", "outcome", "no_retry"));
        assertEquals(0L, counter("wotb_ai_upstream_retries_total", "mode", "TEST_MODE"));
        assertEquals(0, registry.find("wotb_ai_upstream_errors_total").counters().size());
        assertTrue(sleeps.isEmpty());
    }

    @Test
    void retriesWithinBudgetAndSucceeds() {
        gateway(315, new AiRetryPolicy(3, 1000, 8000, 2.0));
        when(chatModel.call(any(Prompt.class)))
                .thenAnswer(invocation -> {
                    now.addAndGet(2_000_000_000L);
                    throw upstream("AI_RATE_LIMITED", 429);
                })
                .thenReturn(okResponse());

        final AiChatResponse result = gateway.chat(request());

        assertEquals("ok", result.completionText());
        assertEquals(2L, counter("wotb_ai_upstream_requests_total", "mode", "TEST_MODE"));
        assertEquals(1L, counter("wotb_ai_upstream_retries_total", "mode", "TEST_MODE"));
        assertEquals(1L, counter("wotb_ai_upstream_retry_outcome_total", "outcome", "success_after_retry"));
        assertEquals(List.of(1000L), sleeps);
    }

    @Test
    void connectionFailureRetriedWithinBudget() {
        gateway(315, new AiRetryPolicy(3, 1000, 8000, 2.0));
        when(chatModel.call(any(Prompt.class)))
                .thenAnswer(invocation -> {
                    now.addAndGet(1_000_000_000L);
                    throw upstream("AI_UPSTREAM_UNAVAILABLE", null);
                })
                .thenReturn(okResponse());

        final AiChatResponse result = gateway.chat(request());

        assertEquals("ok", result.completionText());
        assertEquals(2L, counter("wotb_ai_upstream_requests_total", "mode", "TEST_MODE"));
        assertEquals(1L, counter("wotb_ai_upstream_retries_total", "mode", "TEST_MODE"));
    }

    @Test
    void budgetExhaustedDuringFirstAttemptSkipsSecondRequest() {
        gateway(10, new AiRetryPolicy(3, 1000, 8000, 2.0));
        when(chatModel.call(any(Prompt.class))).thenAnswer(invocation -> {
            now.addAndGet(10_000_000_000L); // attempt consumes the whole budget
            throw upstream("AI_TIMEOUT", null);
        });

        final AiUpstreamException e =
                assertThrows(AiUpstreamException.class, () -> gateway.chat(request()));

        assertEquals("AI_TIMEOUT", e.code());
        assertEquals(1L, counter("wotb_ai_upstream_requests_total", "mode", "TEST_MODE"));
        assertEquals(0L, counter("wotb_ai_upstream_retries_total", "mode", "TEST_MODE"));
        assertEquals(1L, counter("wotb_ai_upstream_errors_total", "type", "AI_TIMEOUT"));
        assertEquals(1L, counter("wotb_ai_upstream_retry_outcome_total", "outcome", "no_retry"));
        assertTrue(sleeps.isEmpty());
    }

    @Test
    void backoffExceedingRemainingBudgetSkipsNextRequest() {
        gateway(10, new AiRetryPolicy(3, 5000, 8000, 2.0));
        when(chatModel.call(any(Prompt.class))).thenAnswer(invocation -> {
            now.addAndGet(9_000_000_000L); // only 1s of budget left
            throw upstream("AI_RATE_LIMITED", 429);
        });

        final AiUpstreamException e =
                assertThrows(AiUpstreamException.class, () -> gateway.chat(request()));

        assertEquals("AI_TIMEOUT", e.code());
        assertEquals(1L, counter("wotb_ai_upstream_requests_total", "mode", "TEST_MODE"));
        assertEquals(0L, counter("wotb_ai_upstream_retries_total", "mode", "TEST_MODE"));
        assertEquals(1L, counter("wotb_ai_upstream_errors_total", "type", "AI_TIMEOUT"));
        assertTrue(sleeps.isEmpty(), "must not sleep when the backoff does not fit the budget");
    }

    @Test
    void thirdAttemptNeverBreachesTotalDeadline() {
        gateway(100, new AiRetryPolicy(3, 0, 0, 2.0));
        when(chatModel.call(any(Prompt.class))).thenAnswer(invocation -> {
            consumeUpTo(40_000_000_000L);
            throw upstream("AI_RATE_LIMITED", 429);
        });

        final AiUpstreamException e =
                assertThrows(AiUpstreamException.class, () -> gateway.chat(request()));

        assertEquals("AI_TIMEOUT", e.code());
        assertEquals(3L, counter("wotb_ai_upstream_requests_total", "mode", "TEST_MODE"));
        assertEquals(2L, counter("wotb_ai_upstream_retries_total", "mode", "TEST_MODE"));
        assertEquals(100_000_000_000L, now.get() - START_NANOS,
                "total elapsed must never exceed the 100s deadline");
    }

    @Test
    void budgetGovernsBeforeAttemptCap() {
        gateway(315, new AiRetryPolicy(5, 0, 0, 2.0));
        when(chatModel.call(any(Prompt.class))).thenAnswer(invocation -> {
            consumeUpTo(100_000_000_000L);
            throw upstream("AI_RATE_LIMITED", 429);
        });

        final AiUpstreamException e =
                assertThrows(AiUpstreamException.class, () -> gateway.chat(request()));

        assertEquals("AI_TIMEOUT", e.code());
        assertEquals(4L, counter("wotb_ai_upstream_requests_total", "mode", "TEST_MODE"),
                "attempts must stop when the 315s total budget is exhausted, before the cap of 5");
        assertEquals(3L, counter("wotb_ai_upstream_retries_total", "mode", "TEST_MODE"));
        assertEquals(315_000_000_000L, now.get() - START_NANOS,
                "AI_CALL_TIMEOUT_SEC is a total-budget bound, not a per-attempt bound");
    }

    @Test
    void interruptedBackoffRestoresInterruptFlag() {
        gateway(315, new AiRetryPolicy(3, 1000, 8000, 2.0));
        when(chatModel.call(any(Prompt.class))).thenThrow(upstream("AI_RATE_LIMITED", 429));
        gateway = new SpringAiChatGateway(chatModel, "test-model", registry,
                new AiRetryPolicy(3, 1000, 8000, 2.0),
                315_000_000_000L, now::get,
                millis -> {
                    sleeps.add(millis);
                    throw new InterruptedException("interrupted");
                });

        final AiUpstreamException e =
                assertThrows(AiUpstreamException.class, () -> gateway.chat(request()));

        assertEquals("AI_RATE_LIMITED", e.code());
        assertEquals(List.of(1000L), sleeps);
        assertTrue(Thread.interrupted(), "interrupt flag must be restored");
        assertEquals(1L, counter("wotb_ai_upstream_errors_total", "type", "AI_RATE_LIMITED"));
    }

    @Test
    void deadlinePassedDuringResponseConversionNeverReturnsSuccess() {
        gateway(100, new AiRetryPolicy(3, 0, 0, 2.0));
        when(chatModel.call(any(Prompt.class))).thenAnswer(invocation -> {
            // The provider returned, but response conversion crosses the total
            // deadline: the gateway must not report success afterwards.
            now.addAndGet(200_000_000_000L);
            return okResponse();
        });

        final AiUpstreamException e =
                assertThrows(AiUpstreamException.class, () -> gateway.chat(request()));

        assertEquals("AI_TIMEOUT", e.code());
        assertEquals(1L, counter("wotb_ai_upstream_requests_total", "mode", "TEST_MODE"));
        assertEquals(0L, counter("wotb_ai_upstream_success_total", "mode", "TEST_MODE"));
        assertEquals(0L, counter("wotb_ai_upstream_tokens_total", "mode", "TEST_MODE"));
        assertEquals(1L, counter("wotb_ai_upstream_errors_total", "type", "AI_TIMEOUT"));
        assertEquals(1L, counter("wotb_ai_upstream_retry_outcome_total", "outcome", "no_retry"));
        assertEquals(0L, counter("wotb_ai_upstream_retries_total", "mode", "TEST_MODE"));
    }

    private void gateway(final long callTimeoutSec, final AiRetryPolicy policy) {
        gatewayCallTimeoutNanos = callTimeoutSec * 1_000_000_000L;
        gateway = new SpringAiChatGateway(chatModel, "test-model", registry, policy,
                gatewayCallTimeoutNanos, now::get, sleeps::add);
    }

    private void consumeUpTo(final long maxNanos) {
        final long remaining = START_NANOS + gatewayCallTimeoutNanos - now.get();
        now.addAndGet(Math.min(maxNanos, Math.max(0, remaining)));
    }

    private long gatewayCallTimeoutNanos;

    private static AiUpstreamException upstream(final String code, final Integer status) {
        return new AiUpstreamException(code, status, "corr-deadline");
    }

    private static AiChatRequest request() {
        return new AiChatRequest("system-prompt", "user-prompt",
                "test-model", null, 4096, true, "max",
                "corr-deadline", "TEST_MODE", null);
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
