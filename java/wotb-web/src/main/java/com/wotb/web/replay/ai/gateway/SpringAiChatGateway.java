package com.wotb.web.replay.ai.gateway;

import java.net.SocketTimeoutException;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;

import com.openai.core.JsonValue;
import com.openai.core.Timeout;
import com.openai.errors.OpenAIException;
import com.openai.errors.OpenAIInvalidDataException;
import com.openai.errors.OpenAIIoException;
import com.openai.errors.OpenAIServiceException;
import com.openai.models.completions.CompletionUsage;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import io.micrometer.observation.ObservationRegistry;
import jakarta.annotation.PreDestroy;
import okhttp3.Call;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.metadata.ChatResponseMetadata;
import org.springframework.ai.chat.metadata.Usage;
import org.springframework.ai.chat.model.ChatModel;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.openai.OpenAiChatModel;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.openai.http.okhttp.OpenAiHttpClientBuilderCustomizer;
import org.springframework.util.StringUtils;

import com.wotb.core.processing.AiNotConfiguredException;
import com.wotb.web.config.AiModelProperties;
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
                if (context.isExpired()) {
                    // Watchdog already fired before this interceptor captured the
                    // Call: cancel so chain.proceed() fails fast without sending.
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
                ? request.correlationId() : UUID.randomUUID().toString();
        final String model = StringUtils.hasText(request.model()) ? request.model() : defaultModel;
        final boolean metrics = meterRegistry != null;
        final Timer.Sample upstreamSample = metrics ? Timer.start(meterRegistry) : null;
        final Prompt prompt = buildPrompt(request, model);
        // Monotonic total deadline for the whole AiChatGateway.chat() lifecycle
        // (first attempt + retries + backoff + response parsing).
        final long deadlineNanos = nanoTimeSource.getAsLong() + callTimeoutNanos;
        int retryCount = 0;
        try {
            while (true) {
                final long remainingNanos = deadlineNanos - nanoTimeSource.getAsLong();
                if (remainingNanos <= 0) {
                    throw finishFailure(
                            new AiUpstreamException("AI_TIMEOUT", null, correlationId),
                            retryCount, request, metrics);
                }
                if (metrics) {
                    meterRegistry.counter(REQUESTS, "mode", request.analysisMode()).increment();
                }
                final AttemptBudgetContext context = new AttemptBudgetContext();
                activeContext.set(context);
                final ScheduledFuture<?> watchdog =
                        scheduleBudgetWatchdog(context, remainingNanos);
                AiUpstreamException failure = null;
                try {
                    attemptStartHook.beforeAttempt(context);
                    final ChatResponse response = chatModel.call(prompt);
                    final AiChatResponse result = toResponse(response, request, model, correlationId);
                    if (context.isExpired() || nanoTimeSource.getAsLong() >= deadlineNanos) {
                        // The deadline passed during response conversion: never
                        // report success, never record usage, end as AI_TIMEOUT.
                        failure = new AiUpstreamException("AI_TIMEOUT", null, correlationId);
                    } else {
                        if (metrics) {
                            meterRegistry.counter(SUCCESS, "mode", request.analysisMode()).increment();
                            recordUsageMetrics(response, request.analysisMode());
                            recordRetryOutcome(request.analysisMode(),
                                    retryCount == 0 ? "no_retry" : "success_after_retry");
                        }
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
                    context.clear();
                    activeContext.remove();
                }
                if (context.isExpired()) {
                    // The in-flight request was aborted because the remaining
                    // total budget ran out: never retry, end as AI_TIMEOUT.
                    failure = new AiUpstreamException("AI_TIMEOUT", null, correlationId, failure);
                }
                final boolean lastAttempt = retryCount >= retryPolicy.maxAttempts() - 1;
                final long remainingAfterNanos = deadlineNanos - nanoTimeSource.getAsLong();
                if (!context.isExpired() && retryPolicy.isRetryable(failure)
                        && remainingAfterNanos <= 0) {
                    // The total budget is exhausted: the deadline is the binding
                    // constraint, so the call ends as AI_TIMEOUT even when the
                    // attempt cap was reached at the same moment.
                    failure = new AiUpstreamException("AI_TIMEOUT", null, correlationId, failure);
                }
                if (!lastAttempt && !context.isExpired()
                        && retryPolicy.isRetryable(failure)) {
                    final long backoffMillis = retryPolicy.backoffMillis(retryCount + 1);
                    if (remainingAfterNanos <= backoffMillis * NANOS_PER_MILLI) {
                        // Not enough budget left for the backoff plus another
                        // attempt: stop without sleeping and without a new request.
                        failure = new AiUpstreamException("AI_TIMEOUT", null, correlationId, failure);
                    } else {
                        retryCount++;
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

    private AiUpstreamException finishFailure(final AiUpstreamException failure,
                                              final int retryCount,
                                              final AiChatRequest request,
                                              final boolean metrics) {
        if (metrics) {
            meterRegistry.counter(ERRORS, "type", failure.code()).increment();
            recordRetryOutcome(request.analysisMode(),
                    retryCount == 0 ? "no_retry" : "failure_after_retry");
        }
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
                finishReason(response),
                Map.of("correlationId", correlationId));
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

    static String safeProviderSummary(final String raw) {
        if (!StringUtils.hasText(raw)) {
            return "empty provider error body";
        }
        return "[PROVIDER_BODY_REDACTED]";
    }

}
