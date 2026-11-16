package com.wotb.ai.gateway;

import com.openai.errors.OpenAIException;
import com.openai.errors.OpenAIInvalidDataException;
import com.openai.errors.OpenAIIoException;
import com.openai.errors.OpenAIServiceException;
import org.slf4j.Logger;
import org.springframework.util.StringUtils;

import java.net.SocketTimeoutException;
import java.util.Locale;
import java.util.function.LongSupplier;

import static com.wotb.ai.gateway.AiGatewayRuntimeState.PROVIDER_NAME;

/** Stable provider error classification and redacted gateway event logging. */
final class AiGatewayFailurePolicy {
    private static final long NANOS_PER_MILLI = 1_000_000L;
    private final Logger logger;
    private final String defaultModel;
    private final AiRetryPolicy retryPolicy;
    private final LongSupplier nanoTimeSource;

    AiGatewayFailurePolicy(final String defaultModel, final AiRetryPolicy retryPolicy,
                           final LongSupplier nanoTimeSource, final Logger logger) {
        this.defaultModel = defaultModel;
        this.retryPolicy = retryPolicy;
        this.nanoTimeSource = nanoTimeSource;
        this.logger = logger;
    }

    AiUpstreamException providerFailure(final Integer status, final String code,
            final String analysisMode, final String correlationId, final String summary) {
        logProviderFailure(status, code, analysisMode, correlationId, summary);
        return new AiUpstreamException(code, status, correlationId);
    }

    /** Cancellation or total-budget expiry takes precedence over a provider failure. */
    AiUpstreamException resolveStopped(final AiUpstreamException failure,
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

    Integer providerStatus(final OpenAIException error) {
        return error instanceof OpenAIServiceException serviceError
                ? serviceError.statusCode() : null;
    }

    /**
     * Recovers the provider HTTP status from an {@link OpenAIServiceException}
     * wrapped by Spring AI / the SDK in a generic runtime exception. Deliberately
     * scoped to the generic adapter boundary: {@link AiUpstreamException} keeps
     * explicit status semantics so terminal AI_TIMEOUT / AI_CANCELLED
     * reclassification never inherits an earlier provider response.
     */
    Integer nestedProviderStatus(final Throwable error) {
        Throwable current = error;
        while (current != null) {
            if (current instanceof OpenAIServiceException serviceError) {
                return serviceError.statusCode();
            }
            final Throwable next = current.getCause();
            if (next == current) {
                return null;
            }
            current = next;
        }
        return null;
    }

    void logProviderFailure(
            final OpenAIException error,
            final String code,
            final String analysisMode,
            final String correlationId) {
        final String summary = error instanceof OpenAIServiceException serviceError
                ? safeProviderSummary(errorBody(serviceError))
                : error.getClass().getSimpleName();
        logProviderFailure(providerStatus(error), code, analysisMode, correlationId, summary);
    }

    void logProviderFailure(
            final Integer status,
            final String code,
            final String analysisMode,
            final String correlationId,
            final String summary) {
        logger.warn(
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

    // ===== AI Review 全链路事件日志 =====

    void logUpstreamStarted(final AiChatRequest request, final String model,
                                    final String correlationId, final int attempt,
                                    final long remainingNanos) {
        logger.info(AiEventLog.line("ai_upstream_call_started", correlationId,
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
    void logUpstreamCompleted(final String correlationId, final int attempt,
                                      final long attemptStartNanos,
                                      final AiChatResponse result) {
        logger.info(AiEventLog.line("ai_upstream_call_completed", correlationId,
                "attempt", attempt,
                "durationMs", Math.max(0L,
                        (nanoTimeSource.getAsLong() - attemptStartNanos) / NANOS_PER_MILLI),
                "promptTokens", result.inputTokens(),
                "completionTokens", result.outputTokens(),
                "totalTokens", result.totalTokens()));
    }

    /**
     * Transport retry（与业务层的 contract recovery 区分）：上游 429/5xx/连接失败后的退避重试。
     * 由 Gateway 单点执行；业务层的 contract recovery 记 {@code ai_review_contract_failed} /
     * {@code ai_review_recovery_triggered} / {@code ai_review_recovery_failed} 事件
     * （原 {@code ai_validation_retry} 已随 2026-10 legacy 契约收敛删除）。
     * <p>字段语义：{@code retryNumber} = 本次退避重试的 1 基序号
     * （retryNumber=1 表示第一次重试，其后的下一次上游调用是 {@code attempt=2}）；
     * 不使用易歧义的 {@code transportAttempt}（该值常被误读为刚失败的 attempt 号）。</p>
     */
    void logTransportRetry(final AiChatRequest request, final String correlationId,
                                   final int retryNumber,
                                   final AiUpstreamException failure,
                                   final long backoffMillis) {
        logger.warn(AiEventLog.line("ai_transport_retry", correlationId,
                "stage", stageOf(request.analysisMode()),
                "mode", request.analysisMode(),
                "retryNumber", retryNumber,
                "reason", failure.code(),
                "backoffMs", backoffMillis));
    }

    /** 终态失败事件：attempt 为已执行的尝试数（含失败这一次）。 */
    void logUpstreamFailed(final AiChatRequest request,
                                   final AiUpstreamException failure,
                                   final int attempt) {
        logger.warn(AiEventLog.line("ai_upstream_call_failed", failure.correlationId(),
                "stage", stageOf(request.analysisMode()),
                "mode", request.analysisMode(),
                "attempt", attempt,
                "errorCode", failure.code(),
                "providerStatus", failure.providerStatus() == null
                        ? "N/A" : String.valueOf(failure.providerStatus()),
                "retryable", retryPolicy.isRetryable(failure)));
    }

    /** analysisMode → 稳定 stage 标签（低基数口径）。 */
    private static String stageOf(final String analysisMode) {
        return switch (analysisMode == null ? "" : analysisMode) {
            case "SINGLE_TEAM_BATTLE" -> "TEAM_CALL_2";
            case "PRE_BATTLE_STRATEGIC_PRIOR" -> "PRE_BATTLE";
            case "TACTICAL_REVIEW_HARNESS" -> "TACTICAL_HARNESS";
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

}
