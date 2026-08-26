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
import java.util.ArrayList;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.concurrent.atomic.AtomicReference;

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
import reactor.core.publisher.Flux;

import com.wotb.core.replay.processing.AiNotConfiguredException;

/**
 * {@link AiChatGateway#stream} unit tests: token callback order, final
 * aggregation (usage / finishReason), budget expiry AI_TIMEOUT, client
 * cancellation AI_CANCELLED, and fail-fast without in-stream retry.
 */
class SpringAiChatGatewayStreamTest {

    private static final long START_NANOS = 1_000_000_000_000L;

    private final AtomicLong now = new AtomicLong(START_NANOS);
    private ChatModel chatModel;
    private SimpleMeterRegistry registry;
    private SpringAiChatGateway gateway;
    private AiCancellationToken cancellation;
    private StringBuilder received;

    @BeforeEach
    void setUp() {
        chatModel = mock(ChatModel.class);
        registry = new SimpleMeterRegistry();
        gateway = new SpringAiChatGateway(chatModel, "test-model", registry,
                new AiRetryPolicy(3, 1000, 8000, 2.0),
                315_000_000_000L, now::get, millis -> {
                });
        cancellation = new AiCancellationToken();
        AiRequestContext.set("corr-stream", cancellation);
        received = new StringBuilder();
    }

    @AfterEach
    void tearDown() {
        AiRequestContext.clear();
    }

    @Test
    void streamsTokensInOrderAndAggregatesCompletion() {
        when(chatModel.stream(any(Prompt.class))).thenReturn(Flux.just(
                chunk("你", null, null),
                chunk("好", new DefaultUsage(10, 1, 11), "STOP")));

        final AiChatResponse result = gateway.stream(request(), received::append);

        assertEquals("你好", received.toString(), "tokens must be delivered in order");
        assertEquals("你好", result.completionText());
        assertEquals("test-model", result.model());
        assertEquals(10, result.inputTokens());
        assertEquals(1, result.outputTokens());
        assertEquals(11, result.totalTokens());
        assertEquals("stop", result.finishReason(), "finish reason must be normalized to lower case");
        assertEquals(1L, counter("wotb_ai_upstream_success_total", "mode", "TEST_MODE"));
    }

    @Test
    void usageAndFinishReasonComeFromLastChunk() {
        when(chatModel.stream(any(Prompt.class))).thenReturn(Flux.just(
                chunk("a", new DefaultUsage(5, 1, 6), "STOP"),
                chunk("b", new DefaultUsage(5, 2, 7), "STOP")));

        final AiChatResponse result = gateway.stream(request(), received::append);

        assertEquals("ab", result.completionText());
        assertEquals(5, result.inputTokens());
        assertEquals(2, result.outputTokens());
        assertEquals(7, result.totalTokens());
        assertEquals(2L, counter("wotb_ai_upstream_tokens_total",
                "mode", "TEST_MODE", "token_type", "output"));
    }

    @Test
    void emptyStreamMapsToAiEmptyResponse() {
        when(chatModel.stream(any(Prompt.class))).thenReturn(Flux.empty());

        final AiUpstreamException e = assertThrows(
                AiUpstreamException.class, () -> gateway.stream(request(), received::append));

        assertEquals("AI_EMPTY_RESPONSE", e.code());
        assertEquals(0L, counter("wotb_ai_upstream_success_total", "mode", "TEST_MODE"));
        assertEquals(1L, counter("wotb_ai_upstream_errors_total", "type", "AI_EMPTY_RESPONSE"));
    }

    @Test
    void cancelBeforeStreamStartsSendsNoRequest() {
        cancellation.cancel();

        final AiUpstreamException e = assertThrows(
                AiUpstreamException.class, () -> gateway.stream(request(), received::append));

        assertEquals("AI_CANCELLED", e.code());
        verify(chatModel, never()).stream(any(Prompt.class));
        assertEquals(0L, counter("wotb_ai_upstream_requests_total", "mode", "TEST_MODE"));
        assertEquals(1L, counter("wotb_ai_upstream_errors_total", "type", "AI_CANCELLED"));
    }

    @Test
    void cancelMidStreamStopsDrainAndMapsAiCancelled() {
        when(chatModel.stream(any(Prompt.class))).thenReturn(Flux.concat(
                Flux.just(chunk("hello", null, null)),
                Flux.defer(() -> {
                    cancellation.cancel();
                    return Flux.just(chunk(" world", null, null));
                })));

        final AiUpstreamException e = assertThrows(
                AiUpstreamException.class, () -> gateway.stream(request(), received::append));

        assertEquals("AI_CANCELLED", e.code());
        assertEquals("hello", received.toString(),
                "tokens emitted before cancellation must be preserved");
        assertEquals(0L, counter("wotb_ai_upstream_success_total", "mode", "TEST_MODE"));
        assertEquals(1L, counter("wotb_ai_upstream_errors_total", "type", "AI_CANCELLED"));
    }

    @Test
    void budgetExpiryBeforeFirstChunkMapsAiTimeout() {
        when(chatModel.stream(any(Prompt.class))).thenReturn(
                Flux.just(chunk("x", null, null)));
        // The watchdog fires before the first chunk arrives (attempt start hook
        // simulates the deadline passing): the drain must stop immediately.
        gateway.attemptStartHook = context -> now.set(START_NANOS + 315_000_000_000L);

        final AiUpstreamException e = assertThrows(
                AiUpstreamException.class, () -> gateway.stream(request(), received::append));

        assertEquals("AI_TIMEOUT", e.code());
        assertEquals(0L, counter("wotb_ai_upstream_success_total", "mode", "TEST_MODE"));
        assertEquals(1L, counter("wotb_ai_upstream_errors_total", "type", "AI_TIMEOUT"));
    }

    @Test
    void budgetExpiryMidStreamMapsAiTimeoutAndKeepsEmittedTokens() {
        when(chatModel.stream(any(Prompt.class))).thenReturn(Flux.concat(
                Flux.just(chunk("part", null, null)),
                Flux.defer(() -> {
                    now.set(START_NANOS + 315_000_000_000L);
                    return Flux.just(chunk(" two", null, null));
                })));

        final AiUpstreamException e = assertThrows(
                AiUpstreamException.class, () -> gateway.stream(request(), received::append));

        assertEquals("AI_TIMEOUT", e.code());
        assertEquals("part", received.toString());
        assertEquals(1L, counter("wotb_ai_upstream_errors_total", "type", "AI_TIMEOUT"));
    }

    @Test
    void upstreamFailureMidStreamBreaksStreamWithoutRetry() {
        when(chatModel.stream(any(Prompt.class))).thenReturn(Flux.concat(
                Flux.just(chunk("partial", null, null)),
                Flux.error(new IllegalStateException("provider broke"))));

        final AiUpstreamException e = assertThrows(
                AiUpstreamException.class, () -> gateway.stream(request(), received::append));

        assertEquals("AI_UPSTREAM_UNAVAILABLE", e.code());
        assertEquals("partial", received.toString(),
                "output emitted before the failure must be kept");
        verify(chatModel, org.mockito.Mockito.times(1)).stream(any(Prompt.class));
        assertEquals(0L, counter("wotb_ai_upstream_retries_total", "mode", "TEST_MODE"));
    }

    @Test
    void consumerExceptionAbortsStreamAndPropagatesUnmapped() {
        when(chatModel.stream(any(Prompt.class))).thenReturn(Flux.just(
                chunk("a", null, null),
                chunk("b", null, null)));

        final IllegalStateException sentinel = new IllegalStateException("sink closed");
        final AtomicReference<String> seen = new AtomicReference<>("");
        final IllegalStateException thrown = assertThrows(
                IllegalStateException.class, () -> gateway.stream(request(), delta -> {
                    seen.set(seen.get() + delta);
                    throw sentinel;
                }));

        assertEquals(sentinel, thrown);
        assertEquals("a", seen.get());
    }

    @Test
    void unconfiguredGatewayRejectsStream() {
        final SpringAiChatGateway unconfigured = SpringAiChatGateway.fromProperties(
                new com.wotb.web.config.AiModelProperties(
                        "", "https://api.deepseek.com", "test-model", 10, 300, 315, 3,
                        1000, 8000, 2.0, 1_000_000, 940_000, 32_768, 16_384, true, "max", false, 4096),
                null);
        assertThrows(AiNotConfiguredException.class,
                () -> unconfigured.stream(request(), received::append));
    }

    @Test
    void streamedDeltaAppendKeepsFullTextInResult() {
        when(chatModel.stream(any(Prompt.class))).thenReturn(Flux.just(
                chunk("甲", null, null),
                chunk("方", null, null),
                chunk("推进", new DefaultUsage(9, 3, 12), "STOP")));

        final AiChatResponse result = gateway.stream(request(), received::append);

        assertTrue(received.toString().equals("甲方推进"));
        assertTrue(result.completionText().equals("甲方推进"));
        assertEquals(3, result.outputTokens());
    }

    @Test
    void largeSingleDeltaIsSplitIntoMultipleConsumerEvents() {
        final String big = "一".repeat(600);
        when(chatModel.stream(any(Prompt.class))).thenReturn(Flux.just(
                chunk(big, null, "STOP")));
        final List<String> deltas = new ArrayList<>();

        final AiChatResponse result = gateway.stream(request(), deltas::add);

        assertTrue(deltas.size() >= 2,
                "large upstream delta must be split into multiple consumer events: " + deltas.size());
        assertEquals(big, String.join("", deltas),
                "split pieces must reassemble to the original text");
        assertEquals(big, result.completionText());
    }

    @Test
    void splitChunksKeepsSentenceBoundariesAndPieceCap() {
        final String text = "第一句。第二句！第三句？\n第四段";
        final List<String> pieces = SpringAiChatGateway.splitChunks(text, 128);
        assertEquals(text, String.join("", pieces), "split must preserve the full text");
        assertTrue(pieces.stream().allMatch(p -> p.length() <= 128),
                "every piece must respect maxPiece: " + pieces);

        final String longText = "x".repeat(2000);
        final List<String> capped = SpringAiChatGateway.splitChunks(longText, 128);
        assertTrue(capped.size() <= SpringAiChatGateway.CHUNK_MAX_PIECES,
                "piece count must not exceed cap: " + capped.size());
        assertEquals(longText, String.join("", capped));
    }

    @Test
    void cancellationDuringLargeDeltaSplitMapsAiCancelled() {
        final String big = "一".repeat(600);
        when(chatModel.stream(any(Prompt.class))).thenReturn(Flux.just(chunk(big, null, "STOP")));
        final AtomicBoolean cancelledOnce = new AtomicBoolean();

        final AiUpstreamException e = assertThrows(AiUpstreamException.class,
                () -> gateway.stream(request(), delta -> {
                    // 第一片已发出后触发取消：下一片发送前的检查必须稳定映射为 AI_CANCELLED
                    if (cancelledOnce.compareAndSet(false, true)) {
                        cancellation.cancel();
                    }
                }));

        assertEquals("AI_CANCELLED", e.code(),
                "cancellation during large-delta split must keep stable code AI_CANCELLED");
    }

    @Test
    void deadlineDuringLargeDeltaSplitMapsAiTimeout() {
        final String big = "一".repeat(600);
        when(chatModel.stream(any(Prompt.class))).thenReturn(Flux.just(chunk(big, null, "STOP")));
        final AtomicBoolean advanced = new AtomicBoolean();

        final AiUpstreamException e = assertThrows(AiUpstreamException.class,
                () -> gateway.stream(request(), delta -> {
                    // 第一片后推进假时钟到 deadline：下一片发送前的检查必须稳定映射为 AI_TIMEOUT
                    if (advanced.compareAndSet(false, true)) {
                        now.set(START_NANOS + 315_000_000_000L);
                    }
                }));

        assertEquals("AI_TIMEOUT", e.code(),
                "deadline during large-delta split must keep stable code AI_TIMEOUT");
    }

    @Test
    void largeDeltaConsumerRuntimeExceptionStillPropagatesUnmapped() {
        final String big = "x".repeat(600);
        when(chatModel.stream(any(Prompt.class))).thenReturn(Flux.just(chunk(big, null, "STOP")));
        final IllegalStateException sentinel = new IllegalStateException("sink closed");

        final IllegalStateException thrown = assertThrows(IllegalStateException.class,
                () -> gateway.stream(request(), delta -> {
                    throw sentinel;
                }));

        assertEquals(sentinel, thrown,
                "real consumer RuntimeException must keep consumer-abort semantics");
    }

    private static AiChatRequest request() {
        return new AiChatRequest("system-prompt", "user-prompt",
                "test-model", null, 4096, true, "max",
                "corr-stream", "TEST_MODE");
    }

    private static ChatResponse chunk(final String delta,
                                      final DefaultUsage usage,
                                      final String finishReason) {
        final Generation generation;
        if (finishReason != null) {
            generation = new Generation(
                    new AssistantMessage(delta),
                    ChatGenerationMetadata.builder().finishReason(finishReason).build());
        } else {
            generation = new Generation(new AssistantMessage(delta));
        }
        final ChatResponseMetadata.Builder metadata = ChatResponseMetadata.builder()
                .model("test-model");
        if (usage != null) {
            metadata.usage(usage);
        }
        return ChatResponse.builder()
                .generations(List.of(generation))
                .metadata(metadata.build())
                .build();
    }

    private long counter(final String name, final String... tags) {
        final Counter counter = registry.find(name).tags(tags).counter();
        return counter != null ? (long) counter.count() : 0L;
    }
}
