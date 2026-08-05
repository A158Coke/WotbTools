package com.wotb.web.replay.ai.gateway;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.wotb.web.replay.ai.AiUpstreamException;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.util.StringUtils;
import org.springframework.web.client.ResourceAccessException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

import java.net.SocketTimeoutException;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

/**
 * 临时 DeepSeek REST 网关实现：把供应商无关的 {@link AiChatRequest} 映射到
 * DeepSeek {@code /chat/completions} 调用，并把 OpenAI 兼容响应映射回
 * {@link AiChatResponse}。
 * <p>这是 Spring AI 迁移过渡期的真实 HTTP 入口；后续 Spring AI 任务将整体替换本类，
 * 届时本类连同其 Provider DTO 与 HTTP 错误分类逻辑一并删除。</p>
 * <p>本类是生产环境唯一发送 AI HTTP 请求的地方。</p>
 */
public class DeepSeekRestAiChatGateway implements AiChatGateway {

    private static final Logger LOGGER = LoggerFactory.getLogger(DeepSeekRestAiChatGateway.class);
    private static final String PROVIDER_NAME = "DeepSeek";

    private final String apiKey;
    private final String baseUrl;
    private final String defaultModel;
    private final int timeoutSec;
    private final RestClient restClient;

    @Autowired(required = false)
    private MeterRegistry meterRegistry;
    private Timer aiUpstreamDuration;

    public DeepSeekRestAiChatGateway(final String apiKey, final String baseUrl,
                                     final String defaultModel, final int timeoutSec) {
        this.apiKey = apiKey == null ? "" : apiKey.trim();
        this.baseUrl = baseUrl;
        this.defaultModel = defaultModel;
        this.timeoutSec = timeoutSec;
        final SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10_000);
        factory.setReadTimeout(Math.max(1, timeoutSec) * 1000);
        this.restClient = RestClient.builder()
                .baseUrl(baseUrl)
                .requestFactory(factory)
                .build();
    }

    @Override
    public boolean isConfigured() {
        return StringUtils.hasText(apiKey);
    }

    @Override
    public AiChatResponse chat(final AiChatRequest request) {
        final String correlationId = StringUtils.hasText(request.correlationId())
                ? request.correlationId() : UUID.randomUUID().toString();
        final String model = StringUtils.hasText(request.model()) ? request.model() : defaultModel;
        final Map<String, Object> body = buildProviderBody(request, model);
        final boolean metrics = meterRegistry != null;
        final Timer.Sample upstreamSample = metrics ? Timer.start(meterRegistry) : null;
        if (metrics) {
            meterRegistry.counter("wotb_ai_upstream_requests_total",
                    "mode", request.analysisMode()).increment();
        }
        String errorType = null;
        try {
            final ChatCompletionResponse response;
            try {
                response = restClient.post()
                        .uri("/chat/completions")
                        .header("Authorization", "Bearer " + apiKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(body)
                        .retrieve()
                        .body(ChatCompletionResponse.class);
            } finally {
                if (upstreamSample != null) {
                    upstreamSample.stop(aiUpstreamDuration);
                }
            }
            final String content = extractContent(response, request.analysisMode(), correlationId);
            if (!StringUtils.hasText(content)) {
                logProviderFailure(null, "AI_EMPTY_RESPONSE", request.analysisMode(),
                        correlationId, "blank completion content");
                errorType = "AI_EMPTY_RESPONSE";
                throw new AiUpstreamException("AI_EMPTY_RESPONSE", null, correlationId);
            }
            final ChatCompletionResponse.Usage usage = response != null ? response.usage() : null;
            logUsage(usage, model, request.analysisMode());
            return new AiChatResponse(
                    content,
                    PROVIDER_NAME,
                    model,
                    usage != null ? usage.promptTokens() : 0,
                    usage != null ? usage.completionTokens() : 0,
                    usage != null ? usage.totalTokens() : 0,
                    usage != null && usage.completionTokensDetails() != null
                            && usage.completionTokensDetails().reasoningTokens() != null
                            ? usage.completionTokensDetails().reasoningTokens() : 0,
                    usage != null && usage.promptCacheHitTokens() != null
                            ? usage.promptCacheHitTokens() : 0,
                    usage != null && usage.promptCacheMissTokens() != null
                            ? usage.promptCacheMissTokens() : 0,
                    extractFinishReason(response),
                    Map.of("correlationId", correlationId));
        } catch (final RestClientResponseException e) {
            final int status = e.getStatusCode().value();
            final String code = classifyHttpError(status, e.getResponseBodyAsString());
            logProviderFailure(status, code, request.analysisMode(), correlationId,
                    safeProviderSummary(e.getResponseBodyAsString()));
            errorType = code;
            throw new AiUpstreamException(code, status, correlationId, e);
        } catch (final ResourceAccessException e) {
            final String code = isTimeout(e) ? "AI_TIMEOUT" : "AI_UPSTREAM_UNAVAILABLE";
            logProviderFailure(null, code, request.analysisMode(), correlationId,
                    e.getClass().getSimpleName());
            errorType = code;
            throw new AiUpstreamException(code, null, correlationId, e);
        } catch (final RestClientException e) {
            final String code = classifyClientFailure(e);
            logProviderFailure(null, code, request.analysisMode(), correlationId,
                    e.getClass().getSimpleName());
            errorType = code;
            throw new AiUpstreamException(code, null, correlationId, e);
        } catch (final AiUpstreamException e) {
            errorType = e.code();
            throw e;
        } finally {
            if (metrics && errorType != null) {
                meterRegistry.counter("wotb_ai_upstream_errors_total",
                        "type", errorType).increment();
            }
        }
    }

    private static Map<String, Object> buildProviderBody(final AiChatRequest request, final String model) {
        final Map<String, Object> body = new LinkedHashMap<>();
        body.put("model", model);
        body.put("stream", false);
        body.put("max_tokens", request.maxOutputTokens());
        if (request.temperature() != null) {
            body.put("temperature", request.temperature());
        }
        body.put("thinking", Map.of("type", request.thinkingEnabled() ? "enabled" : "disabled"));
        if (request.thinkingEnabled() && StringUtils.hasText(request.reasoningEffort())) {
            body.put("reasoning_effort", request.reasoningEffort());
        }
        body.put("messages", List.of(
                Map.of("role", "system", "content", request.systemPrompt()),
                Map.of("role", "user", "content", request.userPrompt())));
        return body;
    }

    private String extractContent(final ChatCompletionResponse response,
                                  final String analysisMode,
                                  final String correlationId) {
        if (response == null || response.choices() == null || response.choices().isEmpty()) {
            logProviderFailure(null, "AI_RESPONSE_INVALID", analysisMode, correlationId,
                    "invalid completion envelope");
            throw new AiUpstreamException("AI_RESPONSE_INVALID", null, correlationId);
        }
        final ChatCompletionResponse.Choice choice = response.choices().getFirst();
        if (choice == null || choice.message() == null || choice.message().content() == null) {
            logProviderFailure(null, "AI_RESPONSE_INVALID", analysisMode, correlationId,
                    "invalid completion envelope");
            throw new AiUpstreamException("AI_RESPONSE_INVALID", null, correlationId);
        }
        return choice.message().content();
    }

    private static String extractFinishReason(final ChatCompletionResponse response) {
        if (response == null || response.choices() == null || response.choices().isEmpty()) {
            return null;
        }
        final ChatCompletionResponse.Choice choice = response.choices().getFirst();
        return choice != null ? choice.finishReason() : null;
    }

    static String classifyHttpError(final int status, final String responseBody) {
        final String body = responseBody == null
                ? "" : responseBody.toLowerCase(Locale.ROOT);
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

    private static boolean isResponseConversionFailure(final Throwable throwable) {
        Throwable current = throwable;
        while (current != null) {
            final String className = current.getClass().getSimpleName();
            if (className.contains("HttpMessage")
                    || className.contains("JsonParse")
                    || className.contains("JsonProcessing")
                    || className.contains("MismatchedInput")
                    || className.contains("Jackson")) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }

    static String classifyClientFailure(final RestClientException error) {
        if (isTimeout(error)) {
            return "AI_TIMEOUT";
        }
        return isResponseConversionFailure(error)
                ? "AI_RESPONSE_INVALID" : "AI_UPSTREAM_UNAVAILABLE";
    }

    private void logProviderFailure(
            final Integer status,
            final String code,
            final String analysisMode,
            final String correlationId,
            final String summary) {
        LOGGER.warn(
                "AI provider failure provider=DeepSeek model={} status={} code={} "
                        + "mode={} correlationId={} summary={}",
                defaultModel,
                status == null ? "N/A" : status,
                code,
                analysisMode,
                correlationId,
                summary);
    }

    private void logUsage(final ChatCompletionResponse.Usage usage, final String model, final String analysisMode) {
        if (usage == null) return;
        LOGGER.info(
                "AI usage model={} mode={} prompt_tokens={} completion_tokens={} "
                        + "total_tokens={} reasoning_tokens={} cache_hit={} cache_miss={}",
                model, analysisMode,
                usage.promptTokens(),
                usage.completionTokens(),
                usage.totalTokens(),
                usage.completionTokensDetails() != null ? usage.completionTokensDetails().reasoningTokens() : "N/A",
                usage.promptCacheHitTokens() != null ? usage.promptCacheHitTokens() : 0,
                usage.promptCacheMissTokens() != null ? usage.promptCacheMissTokens() : 0);
    }

    static String safeProviderSummary(final String raw) {
        if (!StringUtils.hasText(raw)) {
            return "empty provider error body";
        }
        return "[PROVIDER_BODY_REDACTED]";
    }

    @PostConstruct
    void initMetrics() {
        if (meterRegistry == null) {
            return;
        }
        aiUpstreamDuration = Timer.builder("wotb_ai_upstream_duration_seconds")
                .description("AI upstream API call duration")
                .publishPercentileHistogram()
                .register(meterRegistry);
    }

    /**
     * DeepSeek /chat/completions 响应的最小映射（OpenAI 兼容）。忽略未知字段。
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    record ChatCompletionResponse(
            @JsonProperty("choices") List<Choice> choices,
            @JsonProperty("usage") Usage usage
    ) {

        @JsonIgnoreProperties(ignoreUnknown = true)
        record Choice(Message message, @JsonProperty("finish_reason") String finishReason) {
        }

        @JsonIgnoreProperties(ignoreUnknown = true)
        record Message(String content) {
        }

        @JsonIgnoreProperties(ignoreUnknown = true)
        record Usage(
                @JsonProperty("prompt_tokens") int promptTokens,
                @JsonProperty("completion_tokens") int completionTokens,
                @JsonProperty("total_tokens") int totalTokens,
                @JsonProperty("completion_tokens_details") CompletionTokensDetails completionTokensDetails,
                @JsonProperty("prompt_cache_hit_tokens") Integer promptCacheHitTokens,
                @JsonProperty("prompt_cache_miss_tokens") Integer promptCacheMissTokens
        ) {
            @JsonIgnoreProperties(ignoreUnknown = true)
            record CompletionTokensDetails(@JsonProperty("reasoning_tokens") Integer reasoningTokens) {
            }
        }
    }
}