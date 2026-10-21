package com.wotb.ai.gateway;

import com.openai.core.http.Headers;
import com.openai.errors.RateLimitException;
import com.openai.errors.UnauthorizedException;
import com.openai.models.ErrorObject;
import io.micrometer.core.instrument.Meter;
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

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * Verifies the upstream metric surface: existing names stay compatible,
 * new low-cardinality metrics are recorded, and no high-cardinality or
 * prompt/completion data ever becomes a tag.
 */
class SpringAiChatGatewayMetricsTest {

    private SimpleMeterRegistry registry;
    private ChatModel chatModel;
    private SpringAiChatGateway gateway;

    @BeforeEach
    void setUp() {
        registry = new SimpleMeterRegistry();
        chatModel = mock(ChatModel.class);
        gateway = new SpringAiChatGateway(chatModel, "test-model", registry,
                new AiRetryPolicy(3, 0, 0, 2.0));
    }

    @Test
    void successRecordsRequestDurationSuccessTokensAndOutcome() {
        when(chatModel.call(any(Prompt.class))).thenReturn(okResponse());
        gateway.chat(request());
        assertEquals(1L, counter("wotb_ai_upstream_requests_total", "mode", "TEST_MODE"));
        assertEquals(1L, counter("wotb_ai_upstream_success_total", "mode", "TEST_MODE"));
        assertEquals(1L, registry.find("wotb_ai_upstream_duration_seconds")
                .timer().count());
        assertEquals(1L, counter("wotb_ai_upstream_retry_outcome_total",
                "mode", "TEST_MODE", "outcome", "no_retry"));
        assertEquals(0, registry.find("wotb_ai_upstream_errors_total")
                .counters().size());
        assertEquals(1L, counter("wotb_ai_upstream_tokens_total",
                "mode", "TEST_MODE", "token_type", "input"));
        assertEquals(1L, counter("wotb_ai_upstream_tokens_total",
                "mode", "TEST_MODE", "token_type", "output"));
        assertEquals(2L, counter("wotb_ai_upstream_tokens_total",
                "mode", "TEST_MODE", "token_type", "total"));
    }

    @Test
    void failureRecordsRequestDurationErrorAndNoRetryOutcome() {
        when(chatModel.call(any(Prompt.class))).thenThrow(
                UnauthorizedException.builder()
                        .headers(Headers.builder().build())
                        .error(error("bad key"))
                        .build());
        assertThrows(AiUpstreamException.class, () -> gateway.chat(request()));
        assertEquals(1L, counter("wotb_ai_upstream_requests_total", "mode", "TEST_MODE"));
        assertEquals(1L, registry.find("wotb_ai_upstream_duration_seconds")
                .timer().count());
        assertEquals(1L, counter("wotb_ai_upstream_errors_total",
                "type", "AI_AUTHENTICATION_ERROR"));
        assertEquals(1L, counter("wotb_ai_upstream_retry_outcome_total",
                "mode", "TEST_MODE", "outcome", "no_retry"));
        assertEquals(0, registry.find("wotb_ai_upstream_success_total")
                .counters().size());
    }

    @Test
    void retriedFailureRecordsRetriesAndFailureAfterRetryOutcome() {
        when(chatModel.call(any(Prompt.class))).thenThrow(
                RateLimitException.builder()
                        .headers(Headers.builder().build())
                        .error(error("slow down"))
                        .build());
        assertThrows(AiUpstreamException.class, () -> gateway.chat(request()));
        assertEquals(3L, counter("wotb_ai_upstream_requests_total", "mode", "TEST_MODE"));
        assertEquals(2L, counter("wotb_ai_upstream_retries_total", "mode", "TEST_MODE"));
        assertEquals(1L, counter("wotb_ai_upstream_retry_outcome_total",
                "mode", "TEST_MODE", "outcome", "failure_after_retry"));
        assertEquals(1L, counter("wotb_ai_upstream_errors_total",
                "type", "AI_RATE_LIMITED"));
    }

    @Test
    void onlyLowCardinalityTagsAreRecorded() {
        when(chatModel.call(any(Prompt.class))).thenReturn(okResponse());
        gateway.chat(request());
        final Set<String> forbidden = Set.of(
                "nickname", "account_id", "accountId", "file_name", "fileName",
                "correlation_id", "correlationId", "prompt", "completion", "body");
        for (final Meter meter : registry.getMeters()) {
            assertFalse(meter.getId().getTags().stream()
                            .map(tag -> tag.getKey()).anyMatch(forbidden::contains),
                    "forbidden tag on " + meter.getId().getName());
        }
        assertTrue(registry.getMeters().stream()
                .map(meter -> meter.getId().getName())
                .allMatch(name -> name.startsWith("wotb_ai_upstream_")));
    }

    @Test
    void requestUsageAggregatesCallsAndFailedRetryWithoutCountingMissingAsKnown() {
        AiRequestContext.set("review-usage", new AiCancellationToken());
        try {
            when(chatModel.call(any(Prompt.class))).thenThrow(
                    RateLimitException.builder().headers(Headers.builder().build())
                            .error(error("secret provider text")).build())
                    .thenReturn(okResponse());
            gateway.chat(request());
            gateway.chat(request());
            final AiRequestContext.UsageTotals usage = AiRequestContext.usageTotals();
            assertEquals(3, usage.calls);
            assertEquals(1, usage.missingUsageCalls);
            assertEquals(2, usage.inputTokens);
            assertEquals(2, usage.outputTokens);
            assertEquals(4, usage.totalTokens);
        } finally {
            AiRequestContext.clear();
        }
    }

    @Test
    void receivedUsageSurvivesInvalidResponseAndLaterFailure() {
        AiRequestContext.set("review-failure", new AiCancellationToken());
        try {
            final ChatResponse invalid = ChatResponse.builder()
                    .generations(List.of(new Generation(new AssistantMessage(""))))
                    .metadata(ChatResponseMetadata.builder().usage(new DefaultUsage(4, 2, 6)).build())
                    .build();
            when(chatModel.call(any(Prompt.class))).thenReturn(invalid);
            assertThrows(AiUpstreamException.class, () -> gateway.chat(request()));
            assertEquals(6, AiRequestContext.usageTotals().totalTokens);
            assertEquals(1, AiRequestContext.usageTotals().calls);
            assertEquals(0, AiRequestContext.usageTotals().missingUsageCalls);
        } finally {
            AiRequestContext.clear();
        }
    }

    @Test
    void streamUsageIsNotLostOnCancellationAfterProviderResponse() {
        final AiCancellationToken cancellation = new AiCancellationToken();
        AiRequestContext.set("stream-cancel", cancellation);
        try {
            when(chatModel.stream(any(Prompt.class))).thenReturn(reactor.core.publisher.Flux.just(okResponse()));
            assertThrows(AiUpstreamException.class,
                    () -> gateway.stream(request(), delta -> cancellation.cancel()));
            assertEquals(2, AiRequestContext.usageTotals().totalTokens);
            assertEquals(1, AiRequestContext.usageTotals().calls);
            assertEquals(0, AiRequestContext.usageTotals().missingUsageCalls);
        } finally {
            AiRequestContext.clear();
        }
    }

    @Test
    void streamWithoutProviderUsageRecordsMissingInsteadOfKnownZero() {
        AiRequestContext.set("stream-no-usage", new AiCancellationToken());
        try {
            when(chatModel.stream(any(Prompt.class))).thenReturn(reactor.core.publisher.Flux.just(
                    ChatResponse.builder().generations(List.of(new Generation(new AssistantMessage("ok")))).build()));
            gateway.stream(request(), delta -> { });
            assertEquals(1, AiRequestContext.usageTotals().calls);
            assertEquals(1, AiRequestContext.usageTotals().missingUsageCalls);
        } finally {
            AiRequestContext.clear();
        }
    }

    @Test
    void cumulativeStreamingUsageCountsOnlyTheIncrementAndOneCall() {
        AiRequestContext.set("stream-cumulative", new AiCancellationToken());
        try {
            final ChatResponse first = ChatResponse.builder()
                    .generations(List.of(new Generation(new AssistantMessage("a"))))
                    .metadata(ChatResponseMetadata.builder().usage(new DefaultUsage(5, 1, 6)).build()).build();
            final ChatResponse last = ChatResponse.builder()
                    .generations(List.of(new Generation(new AssistantMessage("b"))))
                    .metadata(ChatResponseMetadata.builder().usage(new DefaultUsage(5, 2, 7)).build()).build();
            when(chatModel.stream(any(Prompt.class))).thenReturn(reactor.core.publisher.Flux.just(first, last));
            gateway.stream(request(), delta -> { });
            assertEquals(5, AiRequestContext.usageTotals().inputTokens);
            assertEquals(2, AiRequestContext.usageTotals().outputTokens);
            assertEquals(7, AiRequestContext.usageTotals().totalTokens);
            assertEquals(1, AiRequestContext.usageTotals().calls);
            assertEquals(0, AiRequestContext.usageTotals().missingUsageCalls);
        } finally {
            AiRequestContext.clear();
        }
    }

    private long counter(final String name, final String... tags) {
        return (long) registry.find(name).tags(tags).counter().count();
    }

    private static AiChatRequest request() {
        return new AiChatRequest("system-prompt", "user-prompt",
                "test-model", null, 4096, true, "max",
                "corr-1", "TEST_MODE");
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

    private static ErrorObject error(final String message) {
        return ErrorObject.builder()
                .code("invalid_request_error")
                .message(message)
                .param("")
                .type("invalid_request_error")
                .build();
    }
}
