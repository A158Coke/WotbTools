package com.wotb.web.replay.ai.gateway;

import java.net.SocketTimeoutException;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import com.openai.core.JsonValue;
import com.openai.errors.OpenAIException;
import com.openai.errors.OpenAIInvalidDataException;
import com.openai.errors.OpenAIIoException;
import com.openai.errors.OpenAIServiceException;
import com.openai.models.completions.CompletionUsage;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
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
import org.springframework.util.StringUtils;

import com.wotb.core.processing.AiNotConfiguredException;
import com.wotb.web.config.AiModelProperties;
import com.wotb.web.replay.ai.AiUpstreamException;

/**
 * å”¯ä¸€ç”Ÿäº§ AI transport adapterï¼šå°† {@link AiChatRequest} æ˜ å°„åˆ° Spring AI
 * {@link OpenAiChatModel} ï¼ˆOpenAI-compatible å®˜æ–¹ adapterï¼‰å¹¶è¿žæŽ¥
 * {@code https://api.deepseek.com}ã€‚
 * <p>Spring AI 2.0.0 çš„ DeepSeek Starter æ— æ³•ä¼ é€� {@code thinking}/{@code reasoning_effort}
 * ï¼ˆ2.0.0 jar ä¸­ {@code DeepSeekChatOptions} æ²¡æœ‰è¿™ä¸¤ä¸ªå­—æ®µï¼‰ï¼Œæ•…ä½¿ç”¨å®˜æ–¹
 * OpenAI-compatible adapter çš„ {@code extraBody} æœºåˆ¶åŽŸæ ·ä¼ é€�è¿™ä¸¤ä¸ª DeepSeek æ‹©å±•å­—æ®µã€‚
 * </p>
 * <p>Spring AI / OpenAI SDK ç±»åž‹ä»…å­˜åœ¨æœ¬ adapter ä¸Ž {@link AiGatewayConfig}ï¼›
 * ä¸šåŠ¡å±‚ä¾ç„¶åª›é€šè¿‡ {@link AiChatGateway} æŽ¥å£ã€‚</p>
 */
public class SpringAiChatGateway implements AiChatGateway {

    private static final Logger LOGGER = LoggerFactory.getLogger(SpringAiChatGateway.class);
    private static final String PROVIDER_NAME = "DeepSeek";

    private final ChatModel chatModel;
    private final String defaultModel;
    private final MeterRegistry meterRegistry;
    private Timer aiUpstreamDuration;

    public SpringAiChatGateway(final ChatModel chatModel,
                               final String defaultModel,
                               final MeterRegistry meterRegistry) {
        this.chatModel = chatModel;
        this.defaultModel = defaultModel;
        this.meterRegistry = meterRegistry;
        if (meterRegistry != null) {
            aiUpstreamDuration = Timer.builder("wotb_ai_upstream_duration_seconds")
                    .description("AI upstream API call duration")
                    .publishPercentileHistogram()
                    .register(meterRegistry);
        }
    }

    /**
     * ä»Ž {@link AiModelProperties} æž„å»º gatewayã€‚ç¼ºå°‘ API Key æ—¶ä¸æž„å»º Spring AI clientï¼Œ
     * gateway ä»ç„¶ç”Ÿæˆä½† {@code isConfigured()} è¿”å›ž {@code false}ã€
     * {@link #chat} æŠ›å‡º {@link AiNotConfiguredException}ã€‚
     */
    public static SpringAiChatGateway fromProperties(final AiModelProperties properties,
                                                     final MeterRegistry meterRegistry) {
        if (!StringUtils.hasText(properties.apiKey())) {
            return new SpringAiChatGateway(null, properties.model(), meterRegistry);
        }
        final OpenAiChatOptions.Builder connectionOptions = OpenAiChatOptions.builder();
        connectionOptions.baseUrl(properties.baseUrl());
        connectionOptions.apiKey(properties.apiKey());
        connectionOptions.model(properties.model());
        connectionOptions.timeout(Duration.ofSeconds(properties.timeoutSec()));
        // ä¿æŒä¸Žæ—§ RestClient ä¸€æ ·çš„é€¾æœŸè¡Œä¸ºï¼šä¸è¿›è¡Œ SDK é‡è¯•ã€‚
        connectionOptions.maxRetries(0);
        final ChatModel model = OpenAiChatModel.builder()
                .options(connectionOptions.build())
                .build();
        return new SpringAiChatGateway(model, properties.model(), meterRegistry);
    }

    @Override
    public boolean isConfigured() {
        return chatModel != null;
    }

    /**
     * åŒ…çº§å­˜å–åº•å±‚ Spring AI ChatModelï¼ˆä¸»è¦ç”¨äºŽæµ‹è¯•æ ¡éªŒé…ç½®æ˜ å°„ï¼‰ã€‚
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
        if (metrics) {
            meterRegistry.counter("wotb_ai_upstream_requests_total",
                    "mode", request.analysisMode()).increment();
        }
        String errorType = null;
        try {
            final Prompt prompt = buildPrompt(request, model);
            final ChatResponse response = chatModel.call(prompt);
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
        } catch (final AiUpstreamException e) {
            errorType = e.code();
            throw e;
        } catch (final IllegalArgumentException e) {
            throw e;
        } catch (final OpenAIException e) {
            final String code = classify(e);
            logProviderFailure(e, code, request.analysisMode(), correlationId);
            errorType = code;
            throw new AiUpstreamException(code, providerStatus(e), correlationId, e);
        } catch (final RuntimeException e) {
            final String code = "AI_UPSTREAM_UNAVAILABLE";
            logProviderFailure(null, code, request.analysisMode(), correlationId,
                    e.getClass().getSimpleName());
            errorType = code;
            throw new AiUpstreamException(code, null, correlationId, e);
        } finally {
            if (metrics && errorType != null) {
                meterRegistry.counter("wotb_ai_upstream_errors_total",
                        "type", errorType).increment();
            }
            if (upstreamSample != null) {
                upstreamSample.stop(aiUpstreamDuration);
            }
        }
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
        return response.getResult().getMetadata().getFinishReason();
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

    /**
     * å°† Spring AI / OpenAI SDK å¼‚å¸¸æ˜ å°„ä¸ºç¨³å®šé”™è¯¯ç ã€‚
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
                summary);
    }

    private static void logUsage(final Usage usage,
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
