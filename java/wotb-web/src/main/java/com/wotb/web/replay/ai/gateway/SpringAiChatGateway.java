package com.wotb.web.replay.ai.gateway;

import com.openai.core.JsonValue;
import com.openai.core.Timeout;
import com.openai.errors.OpenAIException;
import com.openai.errors.OpenAIInvalidDataException;
import com.openai.errors.OpenAIIoException;
import com.openai.errors.OpenAIServiceException;
import com.openai.models.completions.CompletionUsage;
import com.wotb.core.replay.processing.AiNotConfiguredException;
import com.wotb.web.config.AiModelProperties;
import com.wotb.web.replay.ai.AiReviewEventLog;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import io.micrometer.observation.ObservationRegistry;
import jakarta.annotation.PreDestroy;
import okhttp3.Call;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.messages.AssistantMessage;
import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.metadata.ChatResponseMetadata;
import org.springframework.ai.chat.metadata.Usage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.model.Generation;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.openai.http.okhttp.OpenAiHttpClientBuilderCustomizer;
import org.springframework.util.StringUtils;

import java.net.SocketTimeoutException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.LongSupplier;

/**
 * The only production AI transport adapter: maps {@link AiChatRequest} onto Spring AI
 * {@link OpenAiChatModel} (official OpenAI-compatible adapter) against
 * {@code https://api.deepseek.com}.
 *
 * <p>Responsibility of this class (single source of truth):
 * explicit connect/read/write/total timeouts, the single retry layer
 * ({@link AiRetryPolicy}), stable error mapping, low-cardinality Micrometer
 * metrics, correlation id and redacted logging. Prompts and completions are
 * never logged and never enter metrics or Spring AI observation (the model is
 * built with a NOOP {@link ObservationRegistry}).</p>
 */
public class SpringAiChatGateway implements AiChatGateway {

    private static final Logger LOGGER = LoggerFactory.getLogger(SpringAiChatGateway.class);
    private static final String PROVIDER_NAME = "DeepSeek";
    // Matches the default AI_CALL_TIMEOUT_SEC (300 read + 10 connect + 5 margin)
    // used when tests construct the gateway without explicit properties.
    private static final long DEFAULT_CALL_TIMEOUT_NANOS = 315_000_000_000L;
    private static final long NANOS_PER_MILLI = 1_000_000L;
    private static final String REQUESTS = "wotb_ai_upstream_requests_total";
    private static final String SUCCESS = "wotb_ai_upstream_success_total";
    private static final String ERRORS = "wotb_ai_upstream_errors_total";
    private static final String DURATION = "wotb_ai_upstream_duration_seconds";
    private static final String RETRIES = "wotb_ai_upstream_retries_total";
    private static final String RETRY_OUTCOME = "wotb_ai_upstream_retry_outcome_total";
    private static final String TOKENS = "wotb_ai_upstream_tokens_total";
    // 超大 delta 分块兜底：上游（如 DeepSeek thinking 关闭后仍可能）一次性返回大块时，
    // 按句切分转发，保证前端 SSE 逐段出字（C2：单请求多条 call2_token 且时间分散）。
    // 正常 token 流（小 delta）不触发、不引入任何额外延迟。
    static final int CHUNK_SPLIT_THRESHOLD = 512;
    static final int CHUNK_MAX_PIECE = 128;
    static final int CHUNK_MAX_PIECES = 512;
    static final long CHUNK_PAUSE_MILLIS = 20L;

    volatile ChatModel chatModel;
    private final String defaultModel;
    private final MeterRegistry meterRegistry;
    private final AiRetryPolicy retryPolicy;
    private final long callTimeoutNanos;
    private final LongSupplier nanoTimeSource;
    private final BudgetSleeper sleeper;
    private final ThreadLocal<AttemptBudgetContext> activeContext = new ThreadLocal<>();
    /**
     * Test hook: runs right before each attempt's {@code chatModel.call(prompt)}
     * so tests can deterministically simulate the watchdog firing before the
     * interceptor captures the Call (package-private, no framework).
     */
    AttemptStartHook attemptStartHook = context -> {
    };
    private volatile ScheduledExecutorService budgetWatchdog;
    private Timer aiUpstreamDuration;

    public SpringAiChatGateway(final ChatModel chatModel,
                               final String defaultModel,
                               final MeterRegistry meterRegistry,
                               final AiRetryPolicy retryPolicy) {
        this(chatModel, defaultModel, meterRegistry, retryPolicy,
                DEFAULT_CALL_TIMEOUT_NANOS, System::nanoTime, Thread::sleep);
    }

    SpringAiChatGateway(final ChatModel chatModel,
                        final String defaultModel,
                        final MeterRegistry meterRegistry,
                        final AiRetryPolicy retryPolicy,
                        final long callTimeoutNanos,
                        final LongSupplier nanoTimeSource,
                        final BudgetSleeper sleeper) {
        this.chatModel = chatModel;
        this.defaultModel = defaultModel;
        this.meterRegistry = meterRegistry;
        this.retryPolicy = retryPolicy != null ? retryPolicy : AiRetryPolicy.DEFAULT;
        this.callTimeoutNanos = callTimeoutNanos > 0 ? callTimeoutNanos : DEFAULT_CALL_TIMEOUT_NANOS;
        this.nanoTimeSource = nanoTimeSource != null ? nanoTimeSource : System::nanoTime;
        this.sleeper = sleeper != null ? sleeper : Thread::sleep;
        if (meterRegistry != null) {
            aiUpstreamDuration = Timer.builder(DURATION)
                    .description("AI upstream API call duration (including retries)")
                    .publishPercentileHistogram()
                    .register(meterRegistry);
        }
    }

    /**
     * Builds the gateway from {@link AiModelProperties}. Without an API key the
     * Spring AI client is not created: the gateway still exists,
     * {@code isConfigured()} returns {@code false} and {@link #chat} throws
     * {@link AiNotConfiguredException}.
     */
    public static SpringAiChatGateway fromProperties(final AiModelProperties properties,
                                                     final MeterRegistry meterRegistry) {
        final SpringAiChatGateway gateway = new SpringAiChatGateway(
                null, properties.model(), meterRegistry, AiRetryPolicy.from(properties),
                properties.callTimeoutSec() * 1_000_000_000L, System::nanoTime, Thread::sleep);
        if (!StringUtils.hasText(properties.apiKey())) {
            return gateway;
        }
        gateway.chatModel = buildModel(properties, gateway);
        return gateway;
    }

    static ChatModel buildModel(final AiModelProperties properties,
                                final SpringAiChatGateway gateway) {
        final OpenAiChatOptions.Builder connectionOptions = OpenAiChatOptions.builder();
        connectionOptions.baseUrl(properties.baseUrl());
        connectionOptions.apiKey(properties.apiKey());
        connectionOptions.model(properties.model());
        // Single retry layer lives in this gateway; the SDK must not retry itself.
        connectionOptions.maxRetries(0);
        connectionOptions.timeout(Duration.ofSeconds(properties.timeoutSec()));
        final OpenAiHttpClientBuilderCustomizer httpCustomizer = builder -> {
            builder.timeout(Timeout.builder()
                    .connect(Duration.ofSeconds(properties.connectTimeoutSec()))
                    .read(Duration.ofSeconds(properties.timeoutSec()))
                    .write(Duration.ofSeconds(properties.timeoutSec()))
                    .request(Duration.ofSeconds(properties.callTimeoutSec()))
                    .build());
            // Capture the in-flight okhttp Call so the total-budget watchdog can
            // abort an attempt that exceeds the remaining deadline, including
            // while the SDK is still reading/parsing the response body (Spring
            // AI 2.0 has no per-request timeout override). The Call reference is
            // deliberately NOT cleared here; it stays until the attempt's outer
            // finally so the watchdog covers the full chatModel.call() lifecycle.
            builder.interceptor(chain -> {
                final AttemptBudgetContext context = gateway.activeContext.get();
                if (context == null) {
                    return chain.proceed(chain.request());
                }
                final Call call = chain.call();
                context.capture(call);
                if (context.isStopped()) {
                    // Watchdog or external cancellation already fired before this
                    // interceptor captured the Call: cancel so chain.proceed()
                    // fails fast without sending.
                    call.cancel();
                }
                return chain.proceed(chain.request());
            });
        };
        return OpenAiChatModel.builder()
                .options(connectionOptions.build())
                .observationRegistry(ObservationRegistry.NOOP)
                .httpClientBuilderCustomizers(List.of(httpCustomizer))
                .build();
    }

    @Override
    public boolean isConfigured() {
        return chatModel != null;
    }

    /**
     * Package-private access for tests that verify configuration mapping.
     */
    ChatModel chatModel() {
        return chatModel;
    }

    @Override
    public AiChatResponse chat(final AiChatRequest request) {
        if (chatModel == null) {
            throw new AiNotConfiguredException();
        }
        final String correlationId = StringUtils.hasText(request.correlationId())
                ? request.correlationId()
                : (StringUtils.hasText(AiRequestContext.correlationId())
                        ? AiRequestContext.correlationId() : UUID.randomUUID().toString());
        // Optional external cancellation (client abort): cancels the in-flight
        // upstream call and stops the retry loop with AI_CANCELLED.
        final AiCancellationToken cancellation = AiRequestContext.cancellationToken();
        final String model = StringUtils.hasText(request.model()) ? request.model() : defaultModel;
        final boolean metrics = meterRegistry != null;
        final Timer.Sample upstreamSample = metrics ? Timer.start(meterRegistry) : null;
        final Prompt prompt = buildPrompt(request, model);
        // Monotonic total deadline for the whole AiChatGateway.chat() lifecycle
        // (first attempt + retries + backoff + response parsing). A per-request
        // stage budget (e.g. harness Call #1) must never exceed the configured total.
        final long requestCallTimeoutNanos = request.callTimeoutSec() != null
                ? Math.min(request.callTimeoutSec() * 1_000_000_000L, callTimeoutNanos)
                : callTimeoutNanos;
        final long deadlineNanos = nanoTimeSource.getAsLong() + requestCallTimeoutNanos;
        int retryCount = 0;
        try {
            while (true) {
                final long remainingNanos = deadlineNanos - nanoTimeSource.getAsLong();
                if (remainingNanos <= 0) {
                    throw finishFailure(
                            new AiUpstreamException("AI_TIMEOUT", null, correlationId),
                            retryCount, request, metrics);
                }
                if (cancellation != null && cancellation.isCancelled()) {
                    // Client aborted before this attempt started: do not send a
                    // new upstream request at all.
                    throw finishFailure(
                            new AiUpstreamException("AI_CANCELLED", null, correlationId),
                            retryCount, request, metrics);
                }
                if (metrics) {
                    meterRegistry.counter(REQUESTS, "mode", request.analysisMode()).increment();
                }
                final AttemptBudgetContext context = new AttemptBudgetContext(cancellation);
                if (cancellation != null) {
                    cancellation.attach(context);
                }
                activeContext.set(context);
                final ScheduledFuture<?> watchdog =
                        scheduleBudgetWatchdog(context, remainingNanos);
                AiUpstreamException failure = null;
                try {
                    attemptStartHook.beforeAttempt(context);
                    logUpstreamStarted(request, model, correlationId, retryCount + 1,
                            Math.max(0L, deadlineNanos - nanoTimeSource.getAsLong()));
                    final long attemptStartNanos = nanoTimeSource.getAsLong();
                    final ChatResponse response = chatModel.call(prompt);
                    final AiChatResponse result = toResponse(response, request, model, correlationId);
                    if (context.isExpired() || nanoTimeSource.getAsLong() >= deadlineNanos) {
                        // The deadline passed during response conversion: never
                        // report success, never record usage, end as AI_TIMEOUT.
                        failure = new AiUpstreamException("AI_TIMEOUT", null, correlationId);
                    } else if (context.isCancelled()) {
                        // Client aborted while the response was being converted:
                        // never report success, never record usage.
                        failure = new AiUpstreamException("AI_CANCELLED", null, correlationId);
                    } else {
                        if (metrics) {
                            meterRegistry.counter(SUCCESS, "mode", request.analysisMode()).increment();
                            recordUsageMetrics(response, request.analysisMode());
                            recordRetryOutcome(request.analysisMode(),
                                    retryCount == 0 ? "no_retry" : "success_after_retry");
                        }
                        logUpstreamCompleted(correlationId, retryCount + 1, attemptStartNanos, result);
                        return result;
                    }
                } catch (final AiUpstreamException e) {
                    failure = e;
                } catch (final IllegalArgumentException e) {
                    throw e;
                } catch (final OpenAIException e) {
                    failure = new AiUpstreamException(
                            classify(e), providerStatus(e), correlationId, e);
                    logProviderFailure(e, failure.code(), request.analysisMode(), correlationId);
                } catch (final RuntimeException e) {
                    failure = new AiUpstreamException(
                            "AI_UPSTREAM_UNAVAILABLE", null, correlationId, e);
                    logProviderFailure(null, failure.code(), request.analysisMode(),
                            correlationId, e.getClass().getSimpleName());
                } finally {
                    watchdog.cancel(false);
                    if (cancellation != null) {
                        cancellation.detach(context);
                    }
                    context.clear();
                    activeContext.remove();
                }
                if (context.isCancelled()) {
                    // Client abort is the binding constraint: never retry, end
                    // as AI_CANCELLED so no further upstream request is sent.
                    failure = new AiUpstreamException("AI_CANCELLED", null, correlationId, failure);
                } else if (context.isExpired()) {
                    // The in-flight request was aborted because the remaining
                    // total budget ran out: never retry, end as AI_TIMEOUT.
                    failure = new AiUpstreamException("AI_TIMEOUT", null, correlationId, failure);
                }
                final boolean lastAttempt = retryCount >= retryPolicy.maxAttempts() - 1;
                final long remainingAfterNanos = deadlineNanos - nanoTimeSource.getAsLong();
                if (!context.isStopped() && retryPolicy.isRetryable(failure)
                        && remainingAfterNanos <= 0) {
                    // The total budget is exhausted: the deadline is the binding
                    // constraint, so the call ends as AI_TIMEOUT even when the
                    // attempt cap was reached at the same moment.
                    failure = new AiUpstreamException("AI_TIMEOUT", null, correlationId, failure);
                }
                if (!lastAttempt && !context.isStopped()
                        && retryPolicy.isRetryable(failure)) {
                    final long backoffMillis = retryPolicy.backoffMillis(retryCount + 1);
                    if (remainingAfterNanos <= backoffMillis * NANOS_PER_MILLI) {
                        // Not enough budget left for the backoff plus another
                        // attempt: stop without sleeping and without a new request.
                        failure = new AiUpstreamException("AI_TIMEOUT", null, correlationId, failure);
                    } else {
                        retryCount++;
                        // retryCount 已自增：第一次重试 → retryNumber=1，下一次上游调用 attempt=2。
                        logTransportRetry(request, correlationId, retryCount, failure, backoffMillis);
                        try {
                            sleepQuietly(backoffMillis, failure);
                        } catch (final AiUpstreamException interruptAbort) {
                            throw finishFailure(interruptAbort, retryCount, request, metrics);
                        }
                        if (metrics) {
                            meterRegistry.counter(RETRIES, "mode", request.analysisMode()).increment();
                        }
                        continue;
                    }
                }
                throw finishFailure(failure, retryCount, request, metrics);
            }
        } finally {
            if (upstreamSample != null) {
                upstreamSample.stop(aiUpstreamDuration);
            }
        }
    }

    @Override
    public AiChatResponse stream(final AiChatRequest request, final StreamConsumer consumer) {
        if (chatModel == null) {
            throw new AiNotConfiguredException();
        }
        final String correlationId = StringUtils.hasText(request.correlationId())
                ? request.correlationId()
                : (StringUtils.hasText(AiRequestContext.correlationId())
                        ? AiRequestContext.correlationId() : UUID.randomUUID().toString());
        // Optional external cancellation (client abort): cancels the in-flight
        // upstream stream and ends the flow with AI_CANCELLED.
        final AiCancellationToken cancellation = AiRequestContext.cancellationToken();
        final String model = StringUtils.hasText(request.model()) ? request.model() : defaultModel;
        final boolean metrics = meterRegistry != null;
        final Timer.Sample upstreamSample = metrics ? Timer.start(meterRegistry) : null;
        final Prompt prompt = buildPrompt(request, model);
        final long requestCallTimeoutNanos = request.callTimeoutSec() != null
                ? Math.min(request.callTimeoutSec() * 1_000_000_000L, callTimeoutNanos)
                : callTimeoutNanos;
        final long deadlineNanos = nanoTimeSource.getAsLong() + requestCallTimeoutNanos;
        // Streaming is a single attempt by design: no in-stream retry, a failure
        // ends the stream and keeps whatever has already been emitted.
        int retryCount = 0;
        try {
            final long remainingNanos = deadlineNanos - nanoTimeSource.getAsLong();
            if (remainingNanos <= 0) {
                throw finishFailure(
                        new AiUpstreamException("AI_TIMEOUT", null, correlationId),
                        retryCount, request, metrics);
            }
            if (cancellation != null && cancellation.isCancelled()) {
                // Client aborted before the stream started: do not send a new
                // upstream request at all.
                throw finishFailure(
                        new AiUpstreamException("AI_CANCELLED", null, correlationId),
                        retryCount, request, metrics);
            }
            if (metrics) {
                meterRegistry.counter(REQUESTS, "mode", request.analysisMode()).increment();
            }
            final AttemptBudgetContext context = new AttemptBudgetContext(cancellation);
            if (cancellation != null) {
                cancellation.attach(context);
            }
            activeContext.set(context);
            final ScheduledFuture<?> watchdog =
                    scheduleBudgetWatchdog(context, remainingNanos);
            try {
                attemptStartHook.beforeAttempt(context);
                logUpstreamStarted(request, model, correlationId, 1,
                        Math.max(0L, deadlineNanos - nanoTimeSource.getAsLong()));
                final long attemptStartNanos = nanoTimeSource.getAsLong();
                final StringBuilder text = new StringBuilder();
                final AtomicReference<ChatResponse> lastResponse = new AtomicReference<>();
                chatModel.stream(prompt)
                        .doOnNext(response -> {
                            if (context.isExpired()
                                    || nanoTimeSource.getAsLong() >= deadlineNanos) {
                                throw new StreamInterruptedMarker("AI_TIMEOUT");
                            }
                            if (context.isCancelled()) {
                                throw new StreamInterruptedMarker("AI_CANCELLED");
                            }
                            final String delta = streamDelta(response);
                            if (StringUtils.hasText(delta)) {
                                text.append(delta);
                                try {
                                    if (delta.length() > CHUNK_SPLIT_THRESHOLD) {
                                        for (final String piece : splitChunks(delta, CHUNK_MAX_PIECE)) {
                                            // 分块转发期间同样遵守取消/超时语义：超大块切分可能耗时数秒，
                                            // 不能在等待期间无视客户端取消或总预算。
                                            if (context.isExpired()
                                                    || nanoTimeSource.getAsLong() >= deadlineNanos) {
                                                throw new StreamInterruptedMarker("AI_TIMEOUT");
                                            }
                                            if (context.isCancelled()) {
                                                throw new StreamInterruptedMarker("AI_CANCELLED");
                                            }
                                            consumer.onDelta(piece);
                                            pauseChunk();
                                        }
                                    } else {
                                        consumer.onDelta(delta);
                                    }
                                } catch (final StreamInterruptedMarker marker) {
                                    // Gateway 自己产生的取消/超时标记：原样向外传播到控制流
                                    // catch，转换为 AI_CANCELLED / AI_TIMEOUT 稳定错误码，
                                    // 不得被当成 consumer/sink 异常包装成 ConsumerAbortException。
                                    throw marker;
                                } catch (final RuntimeException sinkError) {
                                    throw new ConsumerAbortException(sinkError);
                                }
                            }
                            lastResponse.set(response);
                        })
                        .blockLast();
                if (context.isExpired() || nanoTimeSource.getAsLong() >= deadlineNanos) {
                    // Deadline passed while the stream was being drained: never
                    // report success, never record usage, end as AI_TIMEOUT.
                    throw new AiUpstreamException("AI_TIMEOUT", null, correlationId);
                }
                if (context.isCancelled()) {
                    // Client aborted while the stream was being drained.
                    throw new AiUpstreamException("AI_CANCELLED", null, correlationId);
                }
                if (text.isEmpty()) {
                    throw providerFailure(null, "AI_EMPTY_RESPONSE", request.analysisMode(),
                            correlationId, "blank streaming completion content");
                }
                final ChatResponse aggregated =
                        toAggregatedResponse(text.toString(), lastResponse.get(), model);
                if (metrics) {
                    meterRegistry.counter(SUCCESS, "mode", request.analysisMode()).increment();
                    recordUsageMetrics(aggregated, request.analysisMode());
                    recordRetryOutcome(request.analysisMode(), "no_retry");
                }
                final AiChatResponse streamResult = toResponse(aggregated, request, model, correlationId);
                logUpstreamCompleted(correlationId, 1, attemptStartNanos, streamResult);
                return streamResult;
            } catch (final AiUpstreamException e) {
                throw finishFailure(e, retryCount, request, metrics);
            } catch (final StreamInterruptedMarker marker) {
                throw finishFailure(new AiUpstreamException(
                        marker.code, null, correlationId, marker), retryCount, request, metrics);
            } catch (final ConsumerAbortException abort) {
                // The consumer (SSE sink) aborted the stream: propagate its
                // exception untouched so the caller can react to it.
                throw abort.getCause();
            } catch (final OpenAIException e) {
                final AiUpstreamException failure = new AiUpstreamException(
                        classify(e), providerStatus(e), correlationId, e);
                logProviderFailure(e, failure.code(), request.analysisMode(), correlationId);
                throw finishFailure(resolveStopped(failure, context, correlationId),
                        retryCount, request, metrics);
            } catch (final RuntimeException e) {
                if (context.isCancelled()) {
                    throw finishFailure(new AiUpstreamException(
                            "AI_CANCELLED", null, correlationId, e), retryCount, request, metrics);
                }
                if (context.isExpired()) {
                    throw finishFailure(new AiUpstreamException(
                            "AI_TIMEOUT", null, correlationId, e), retryCount, request, metrics);
                }
                throw finishFailure(new AiUpstreamException(
                        "AI_UPSTREAM_UNAVAILABLE", null, correlationId, e),
                        retryCount, request, metrics);
            } finally {
                watchdog.cancel(false);
                if (cancellation != null) {
                    cancellation.detach(context);
                }
                context.clear();
                activeContext.remove();
            }
        } finally {
            if (upstreamSample != null) {
                upstreamSample.stop(aiUpstreamDuration);
            }
        }
    }

    /**
     * A client abort or budget expiry that happens to coincide with an upstream
     * failure is the binding constraint: never report the raw provider error.
     */
    private static AiUpstreamException resolveStopped(final AiUpstreamException failure,
                                                      final AttemptBudgetContext context,
                                                      final String correlationId) {
        if (context.isCancelled()) {
            return new AiUpstreamException("AI_CANCELLED", null, correlationId, failure);
        }
        if (context.isExpired()) {
            return new AiUpstreamException("AI_TIMEOUT", null, correlationId, failure);
        }
        return failure;
    }

    private static String streamDelta(final ChatResponse response) {
        if (response == null || response.getResult() == null
                || response.getResult().getOutput() == null) {
            return "";
        }
        final String delta = response.getResult().getOutput().getText();
        return delta != null ? delta : "";
    }

    /**
     * 把超大 delta 按句子边界切成 ≤{@code maxPiece} 字符的片段。
     * <p>优先在句子边界（。！？；\n 及英文 .!?;）切分，无边界时按 {@code maxPiece} 硬切；
     * 片段数上限 {@link #CHUNK_MAX_PIECES}——文本过长时按需放大单片段长度，
     * 避免分片过多（每片带 ~20ms 间隔）拖慢整篇展示。</p>
     */
    static List<String> splitChunks(final String text, final int maxPiece) {
        if (text == null || text.isEmpty()) {
            return List.of();
        }
        final int base = Math.max(1, maxPiece);
        final int effectiveMax = Math.max(
                base, (int) Math.ceil((double) text.length() / CHUNK_MAX_PIECES));
        final List<String> pieces = new ArrayList<>();
        int start = 0;
        while (start < text.length()) {
            final int end = Math.min(text.length(), start + effectiveMax);
            int cut = end;
            if (end < text.length()) {
                for (int i = end - 1; i > start; i--) {
                    final char c = text.charAt(i);
                    if (c == '。' || c == '！' || c == '？' || c == '；'
                            || c == '\n' || c == '.' || c == '!' || c == '?' || c == ';') {
                        cut = i + 1;
                        break;
                    }
                }
            }
            pieces.add(text.substring(start, cut));
            start = cut;
        }
        return pieces;
    }

    /** 分块兜底时每片之间的轻量间隔（仅触发切分时调用；中断恢复标志后继续）。 */
    private static void pauseChunk() {
        try {
            Thread.sleep(CHUNK_PAUSE_MILLIS);
        } catch (final InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /**
     * Aggregates a drained stream into a single Spring AI response: the full
     * text plus the usage / model / finish reason of the last chunk (DeepSeek
     * returns usage and finish reason only on the final streaming chunk).
     */
    private ChatResponse toAggregatedResponse(final String text,
                                              final ChatResponse last,
                                              final String model) {
        final ChatResponseMetadata metadata = last != null ? last.getMetadata() : null;
        final Generation generation;
        if (last != null && last.getResult() != null
                && last.getResult().getMetadata() != null) {
            generation = new Generation(
                    new AssistantMessage(text), last.getResult().getMetadata());
        } else {
            generation = new Generation(new AssistantMessage(text));
        }
        return ChatResponse.builder()
                .generations(List.of(generation))
                .metadata(metadata != null ? metadata
                        : ChatResponseMetadata.builder().model(model).build())
                .build();
    }

    private AiUpstreamException finishFailure(final AiUpstreamException failure,
                                              final int retryCount,
                                              final AiChatRequest request,
                                              final boolean metrics) {
        if (metrics) {
            meterRegistry.counter(ERRORS, "type", failure.code()).increment();
            recordRetryOutcome(request.analysisMode(),
                    retryCount == 0 ? "no_retry" : "failure_after_retry");
        }
        // 终态失败事件（docs/architecture/ai-review.md §42）：attempt 为该请求已执行的尝试数。
        logUpstreamFailed(request, failure, retryCount + 1);
        return failure;
    }

    private ScheduledFuture<?> scheduleBudgetWatchdog(final AttemptBudgetContext context,
                                                      final long remainingNanos) {
        return budgetWatchdog().schedule(
                context::expireAndCancel, remainingNanos, TimeUnit.NANOSECONDS);
    }

    private ScheduledExecutorService budgetWatchdog() {
        ScheduledExecutorService current = budgetWatchdog;
        if (current == null) {
            synchronized (this) {
                current = budgetWatchdog;
                if (current == null) {
                    final ScheduledThreadPoolExecutor executor = new ScheduledThreadPoolExecutor(
                            1, runnable -> {
                        final Thread thread = new Thread(runnable, "wotb-ai-budget-watchdog");
                        thread.setDaemon(true);
                        return thread;
                    });
                    // Cancelled watchdog tasks must not stay queued forever.
                    executor.setRemoveOnCancelPolicy(true);
                    executor.setExecuteExistingDelayedTasksAfterShutdownPolicy(false);
                    current = executor;
                    budgetWatchdog = current;
                }
            }
        }
        return current;
    }

    @PreDestroy
    void shutdownBudgetWatchdog() {
        final ScheduledExecutorService current = budgetWatchdog;
        if (current != null) {
            current.shutdown();
        }
    }

    private AiChatResponse toResponse(final ChatResponse response,
                                      final AiChatRequest request,
                                      final String model,
                                      final String correlationId) {
        final String content = extractContent(response, request.analysisMode(), correlationId);
        final ChatResponseMetadata metadata = response.getMetadata();
        final Usage usage = metadata != null ? metadata.getUsage() : null;
        logUsage(usage, model, request.analysisMode());
        return new AiChatResponse(
                content,
                PROVIDER_NAME,
                metadata != null && StringUtils.hasText(metadata.getModel())
                        ? metadata.getModel() : model,
                usage != null && usage.getPromptTokens() != null ? usage.getPromptTokens() : 0,
                usage != null && usage.getCompletionTokens() != null ? usage.getCompletionTokens() : 0,
                usage != null && usage.getTotalTokens() != null ? usage.getTotalTokens() : 0,
                reasoningTokens(usage),
                cacheHitTokens(usage),
                cacheMissTokens(usage),
                finishReason(response));
    }

    private static Prompt buildPrompt(final AiChatRequest request, final String model) {
        final Map<String, Object> extraBody = new LinkedHashMap<>();
        extraBody.put("thinking", Map.of(
                "type", request.thinkingEnabled() ? "enabled" : "disabled"));
        if (request.thinkingEnabled() && StringUtils.hasText(request.reasoningEffort())) {
            extraBody.put("reasoning_effort", request.reasoningEffort());
        }
        final OpenAiChatOptions.Builder options = OpenAiChatOptions.builder();
        options.model(model);
        options.maxTokens(request.maxOutputTokens());
        options.extraBody(extraBody);
        // Per-request output format（docs/architecture/ai-review.md §8/§10）：JSON_OBJECT → 原生
        // response_format=json_object；TEXT 不发送 response_format（最小 provider surface，
        // 绝不全局污染连接级 model options，§9）。
        if (request.responseFormat() == AiResponseFormat.JSON_OBJECT) {
            options.responseFormat(OpenAiChatModel.ResponseFormat.builder()
                    .type(OpenAiChatModel.ResponseFormat.Type.JSON_OBJECT)
                    .build());
        }
        if (request.temperature() != null) {
            options.temperature(request.temperature());
        }
        return new Prompt(
                List.of(
                        new SystemMessage(request.systemPrompt()),
                        new UserMessage(request.userPrompt())),
                options.build());
    }

    private String extractContent(final ChatResponse response,
                                  final String analysisMode,
                                  final String correlationId) {
        if (response == null || response.getResult() == null
                || response.getResult().getOutput() == null) {
            throw providerFailure(null, "AI_RESPONSE_INVALID", analysisMode, correlationId,
                    "invalid completion envelope");
        }
        final String content = response.getResult().getOutput().getText();
        if (!StringUtils.hasText(content)) {
            throw providerFailure(null, "AI_EMPTY_RESPONSE", analysisMode, correlationId,
                    "blank completion content");
        }
        return content;
    }

    private static String finishReason(final ChatResponse response) {
        if (response == null || response.getResult() == null
                || response.getResult().getMetadata() == null) {
            return null;
        }
        final String reason = response.getResult().getMetadata().getFinishReason();
        // The SDK normalizes finish_reason to an enum name (e.g. "STOP"); the
        // legacy gateway returned the raw provider value ("stop"). Keep the
        // original casing contract by normalizing to lower case.
        return reason != null ? reason.toLowerCase(Locale.ROOT) : null;
    }

    private AiUpstreamException providerFailure(
            final Integer status, final String code, final String analysisMode,
            final String correlationId, final String summary) {
        logProviderFailure(status, code, analysisMode, correlationId, summary);
        return new AiUpstreamException(code, status, correlationId);
    }

    private static int reasoningTokens(final Usage usage) {
        if (usage == null || !(usage.getNativeUsage() instanceof CompletionUsage completionUsage)) {
            return 0;
        }
        return completionUsage.completionTokensDetails()
                .flatMap(details -> details.reasoningTokens())
                .map(Long::intValue)
                .orElse(0);
    }

    private static int cacheHitTokens(final Usage usage) {
        if (usage == null) {
            return 0;
        }
        final Long mapped = usage.getCacheReadInputTokens();
        if (mapped != null && mapped > 0) {
            return mapped.intValue();
        }
        return nativeUsageLong(usage, "prompt_cache_hit_tokens");
    }

    private static int cacheMissTokens(final Usage usage) {
        if (usage == null) {
            return 0;
        }
        return nativeUsageLong(usage, "prompt_cache_miss_tokens");
    }

    private static int nativeUsageLong(final Usage usage, final String key) {
        if (!(usage.getNativeUsage() instanceof CompletionUsage completionUsage)) {
            return 0;
        }
        final JsonValue value = completionUsage._additionalProperties().get(key);
        if (value == null) {
            return 0;
        }
        try {
            final Long parsed = value.convert(Long.class);
            return parsed != null ? parsed.intValue() : 0;
        } catch (final RuntimeException e) {
            return 0;
        }
    }

    private void recordUsageMetrics(final ChatResponse response, final String mode) {
        final Usage usage = response != null && response.getMetadata() != null
                ? response.getMetadata().getUsage() : null;
        if (usage == null) {
            return;
        }
        recordTokens(mode, "input",
                usage.getPromptTokens() != null ? usage.getPromptTokens() : 0);
        recordTokens(mode, "output",
                usage.getCompletionTokens() != null ? usage.getCompletionTokens() : 0);
        recordTokens(mode, "total",
                usage.getTotalTokens() != null ? usage.getTotalTokens() : 0);
        recordTokens(mode, "reasoning", reasoningTokens(usage));
        recordTokens(mode, "cache_hit", cacheHitTokens(usage));
        recordTokens(mode, "cache_miss", cacheMissTokens(usage));
    }

    private void recordTokens(final String mode, final String tokenType, final int value) {
        if (value > 0) {
            meterRegistry.counter(TOKENS, "mode", mode, "token_type", tokenType)
                    .increment(value);
        }
    }

    private void recordRetryOutcome(final String mode, final String outcome) {
        meterRegistry.counter(RETRY_OUTCOME, "mode", mode, "outcome", outcome).increment();
    }

    private void sleepQuietly(final long millis, final AiUpstreamException pending) {
        if (millis <= 0) {
            return;
        }
        try {
            sleeper.sleep(millis);
        } catch (final InterruptedException e) {
            Thread.currentThread().interrupt();
            throw pending;
        }
    }

    /**
     * Small internal abstraction so the total-budget tests can control time
     * deterministically without a framework.
     */
    @FunctionalInterface
    interface BudgetSleeper {
        void sleep(long millis) throws InterruptedException;
    }

    /**
     * Package-private test hook executed before each attempt, allowing tests to
     * deterministically expire the budget before the interceptor captures the
     * in-flight Call.
     */
    @FunctionalInterface
    interface AttemptStartHook {
        void beforeAttempt(AttemptBudgetContext context);
    }

    /**
     * Maps Spring AI / OpenAI SDK exceptions to stable error codes.
     */
    static String classify(final OpenAIException error) {
        if (error instanceof OpenAIServiceException serviceError) {
            return classifyHttpError(serviceError.statusCode(), errorBody(serviceError));
        }
        if (error instanceof OpenAIIoException ioError) {
            return isTimeout(ioError) ? "AI_TIMEOUT" : "AI_UPSTREAM_UNAVAILABLE";
        }
        if (error instanceof OpenAIInvalidDataException) {
            return "AI_RESPONSE_INVALID";
        }
        return "AI_UPSTREAM_UNAVAILABLE";
    }

    static String classifyHttpError(final int status, final String responseBody) {
        final String body = responseBody == null ? "" : responseBody.toLowerCase(Locale.ROOT);
        if (status == 413 || body.contains("context length")
                || body.contains("maximum context")
                || body.contains("too many tokens")) {
            return "AI_CONTEXT_TOO_LARGE";
        }
        return switch (status) {
            case 400, 422 -> "AI_INVALID_REQUEST";
            case 401, 403 -> "AI_AUTHENTICATION_ERROR";
            case 408 -> "AI_TIMEOUT";
            case 429 -> "AI_RATE_LIMITED";
            default -> status >= 500
                    ? "AI_UPSTREAM_UNAVAILABLE" : "AI_INVALID_REQUEST";
        };
    }

    static boolean isTimeout(final Throwable throwable) {
        Throwable current = throwable;
        while (current != null) {
            if (current instanceof SocketTimeoutException
                    || current.getClass().getSimpleName().contains("Timeout")) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }

    private static String errorBody(final OpenAIServiceException error) {
        try {
            return error.body() != null ? error.body().toString() : "";
        } catch (final RuntimeException e) {
            return "";
        }
    }

    private static Integer providerStatus(final OpenAIException error) {
        return error instanceof OpenAIServiceException serviceError
                ? serviceError.statusCode() : null;
    }

    private void logProviderFailure(
            final OpenAIException error,
            final String code,
            final String analysisMode,
            final String correlationId) {
        final String summary = error instanceof OpenAIServiceException serviceError
                ? safeProviderSummary(errorBody(serviceError))
                : error.getClass().getSimpleName();
        logProviderFailure(providerStatus(error), code, analysisMode, correlationId, summary);
    }

    private void logProviderFailure(
            final Integer status,
            final String code,
            final String analysisMode,
            final String correlationId,
            final String summary) {
        LOGGER.warn(
                "AI provider failure provider={} model={} status={} code={} "
                        + "mode={} correlationId={} summary={}",
                PROVIDER_NAME,
                defaultModel,
                status == null ? "N/A" : status,
                code,
                analysisMode,
                correlationId,
                AiSecretRedactor.redact(summary));
    }

    private void logUsage(final Usage usage,
                          final String model,
                          final String analysisMode) {
        if (usage == null) {
            return;
        }
        LOGGER.info(
                "AI usage model={} mode={} prompt_tokens={} completion_tokens={} "
                        + "total_tokens={} reasoning_tokens={} cache_hit={} cache_miss={}",
                model, analysisMode,
                usage.getPromptTokens(),
                usage.getCompletionTokens(),
                usage.getTotalTokens(),
                reasoningTokens(usage),
                cacheHitTokens(usage),
                cacheMissTokens(usage));
    }


    // ===== AI Review 全链路事件日志（docs/architecture/ai-review.md §42/§43） =====

    private void logUpstreamStarted(final AiChatRequest request, final String model,
                                    final String correlationId, final int attempt,
                                    final long remainingNanos) {
        LOGGER.info(AiReviewEventLog.line("ai_upstream_call_started", correlationId,
                "stage", stageOf(request.analysisMode()),
                "mode", request.analysisMode(),
                "attempt", attempt,
                "model", model,
                "responseFormat", request.responseFormat(),
                "thinking", request.thinkingEnabled(),
                "maxOutputTokens", request.maxOutputTokens(),
                "remainingBudgetSec", nanosToSec(remainingNanos)));
    }

    /**
     * 上游调用成功：不记录 providerStatus=200 这类硬编码常量——Spring AI
     * 成功响应不暴露 HTTP status metadata，伪 observation 会误导排障；真实 provider status
     * 只在失败事件（ai_upstream_call_failed）从异常元数据中提取。
     */
    private void logUpstreamCompleted(final String correlationId, final int attempt,
                                      final long attemptStartNanos,
                                      final AiChatResponse result) {
        LOGGER.info(AiReviewEventLog.line("ai_upstream_call_completed", correlationId,
                "attempt", attempt,
                "durationMs", Math.max(0L,
                        (nanoTimeSource.getAsLong() - attemptStartNanos) / NANOS_PER_MILLI),
                "promptTokens", result.inputTokens(),
                "completionTokens", result.outputTokens(),
                "totalTokens", result.totalTokens()));
    }

    /**
     * Transport retry（§43 与 validation retry 区分）：上游 429/5xx/连接失败后的退避重试。
     * 由 Gateway 单点执行；业务层的 validation retry 用 ai_validation_retry 事件。
     * <p>字段语义：{@code retryNumber} = 本次退避重试的 1 基序号
     * （retryNumber=1 表示第一次重试，其后的下一次上游调用是 {@code attempt=2}）；
     * 不使用易歧义的 {@code transportAttempt}（该值常被误读为刚失败的 attempt 号）。</p>
     */
    private void logTransportRetry(final AiChatRequest request, final String correlationId,
                                   final int retryNumber,
                                   final AiUpstreamException failure,
                                   final long backoffMillis) {
        LOGGER.warn(AiReviewEventLog.line("ai_transport_retry", correlationId,
                "stage", stageOf(request.analysisMode()),
                "mode", request.analysisMode(),
                "retryNumber", retryNumber,
                "reason", failure.code(),
                "backoffMs", backoffMillis));
    }

    /** 终态失败事件：attempt 为已执行的尝试数（含失败这一次）。 */
    private void logUpstreamFailed(final AiChatRequest request,
                                   final AiUpstreamException failure,
                                   final int attempt) {
        LOGGER.warn(AiReviewEventLog.line("ai_upstream_call_failed", failure.correlationId(),
                "stage", stageOf(request.analysisMode()),
                "mode", request.analysisMode(),
                "attempt", attempt,
                "errorCode", failure.code(),
                "providerStatus", failure.providerStatus() == null
                        ? "N/A" : String.valueOf(failure.providerStatus()),
                "retryable", retryPolicy.isRetryable(failure)));
    }

    /** analysisMode → 稳定 stage 标签（§42 口径，低基数）。 */
    private static String stageOf(final String analysisMode) {
        return switch (analysisMode == null ? "" : analysisMode) {
            case "SINGLE_TEAM_BATTLE" -> "TEAM_CALL_2";
            case "PRE_BATTLE_STRATEGIC_PRIOR" -> "PRE_BATTLE";
            case "TACTICAL_REVIEW_HARNESS" -> "TACTICAL_HARNESS";
            case "TEAM_AUTOPSY" -> "AUTOPSY";
            default -> "PLAYER";
        };
    }

    private static long nanosToSec(final long nanos) {
        return Math.max(0L, nanos / 1_000_000_000L);
    }

    static String safeProviderSummary(final String raw) {
        if (!StringUtils.hasText(raw)) {
            return "empty provider error body";
        }
        return "[PROVIDER_BODY_REDACTED]";
    }

    /**
     * Internal signal raised inside the stream drain loop when the total budget
     * expired or the client cancelled mid-stream, so the stream terminates
     * immediately instead of waiting for the next upstream chunk.
     */
    private static final class StreamInterruptedMarker extends RuntimeException {
        private final String code;

        StreamInterruptedMarker(final String code) {
            super(code);
            this.code = code;
        }
    }

    /**
     * Wraps an exception thrown by the {@link StreamConsumer} so the stream
     * drain loop can distinguish "caller aborted" from upstream failures.
     */
    private static final class ConsumerAbortException extends RuntimeException {
        ConsumerAbortException(final RuntimeException cause) {
            super(cause);
        }

        @Override
        public RuntimeException getCause() {
            return (RuntimeException) super.getCause();
        }
    }

}
