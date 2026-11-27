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
