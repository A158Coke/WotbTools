package com.wotb.ai.review.service;

import com.wotb.ai.gateway.AiCancellationToken;
import com.wotb.ai.gateway.AiEventLog;
import com.wotb.ai.gateway.AiRequestContext;
import com.wotb.ai.gateway.AiUpstreamException;
import com.wotb.ai.review.AiCancellationRegistry;
import com.wotb.ai.review.AiPromptBudgetExceededException;
import com.wotb.ai.review.AiReviewStreamListener;
import com.wotb.ai.review.AiTimelineUnusableException;
import com.wotb.core.replay.processing.AiNotConfiguredException;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import java.io.IOException;
import java.util.Map;

@Service
public class AiReviewExecutionService {
    private static final Logger LOGGER = LoggerFactory.getLogger(AiReviewExecutionService.class);
    private final AiReviewAnalysisService analysisService;
    private final AiCancellationRegistry cancellations;
    private final MeterRegistry meterRegistry;
    private final Timer reviewDuration;

    public AiReviewExecutionService(final AiReviewAnalysisService analysisService,
                                    final AiCancellationRegistry cancellations, final MeterRegistry meterRegistry) {
        this.analysisService = analysisService;
        this.cancellations = cancellations;
        this.meterRegistry = meterRegistry;
        this.reviewDuration = Timer.builder("wotb_ai_review_duration_seconds")
                .description("AI Review 完整总耗时（成功与异常都结束）")
                .publishPercentileHistogram().register(meterRegistry);
    }

    void execute(final PreparedAiReview prepared, final SseEmitter emitter) {
        final var request = prepared.request();
        final AiCancellationToken cancellation = prepared.cancellation();
        AiRequestContext.set(request.correlationId(), cancellation);
        meterRegistry.counter("wotb_ai_review_requests_total").increment();
        final Timer.Sample durationSample = Timer.start(meterRegistry);
        String result = "success";
        String errorType = null;
        try {
            if (cancellation.isCancelled()) {
                result = "failure";
                errorType = "AI_CANCELLED";
                emitter.complete();
                return;
            }
            final AiReviewStreamListener listener = new AiReviewStreamListener() {
                @Override
                public void onStage(final String stage) {
                    send(emitter, cancellation, stage, Map.of());
                }

                @Override public void onToken(final String delta) {
                    send(emitter, cancellation, "call2_token", Map.of("delta", delta));
                }
            };
            final var done = analysisService.analyze(request.battle(), request.reconstruction(), request.language(),
                    prepared.scope(), prepared.capability(), listener);
            send(emitter, cancellation, "done", done);
            emitter.complete();
        } catch (final RuntimeException error) {
            result = isRejected(error) ? "rejected" : "failure";
            errorType = errorCodeOf(error);
            if (error instanceof ClientDisconnectedException) {
                cancellations.cancel(request.correlationId());
            } else {
                LOGGER.warn(AiEventLog.line("ai_review_error", request.correlationId(), "feature", "ai_review",
                        "errorCode", errorType, "providerStatus", providerStatusOf(error),
                        "exceptionType", error.getClass().getSimpleName()));
                try {
                    emitter.send(SseEmitter.event().name("error")
                            .data(Map.of("id", request.correlationId(), "errorCode", errorType)));
                } catch (final IOException | IllegalStateException ignored) {
                    cancellations.cancel(request.correlationId());
                }
            }
            emitter.complete();
        } finally {
            durationSample.stop(reviewDuration);
            meterRegistry.counter("wotb_ai_review_results_total", "result", result).increment();
            if (errorType != null) {
                meterRegistry.counter("wotb_ai_review_errors_total", "type", errorType).increment();
            }
            final AiRequestContext.UsageTotals usage = AiRequestContext.usageTotals();
            LOGGER.info(AiEventLog.line("ai_review_usage", request.correlationId(), "inputTokens", usage.inputTokens,
                    "outputTokens", usage.outputTokens, "totalTokens", usage.totalTokens, "calls", usage.calls,
                    "missingUsageCalls", usage.missingUsageCalls, "result", result,
                    "errorCode", errorType == null ? "none" : errorType));
            AiRequestContext.clear();
            cancellations.unregister(request.correlationId(), cancellation);
        }
    }

    private static boolean isRejected(final RuntimeException error) {
        return error instanceof AiTimelineUnusableException || error instanceof AiNotConfiguredException
                || error instanceof AiPromptBudgetExceededException;
    }

    private static String errorCodeOf(final RuntimeException error) {
        if (error instanceof AiTimelineUnusableException) {
            return AiTimelineUnusableException.STABLE_ERROR_CODE;
        }
        if (error instanceof AiUpstreamException upstream) {
            return upstream.code();
        }
        if (error instanceof AiNotConfiguredException) {
            return "AI_NOT_CONFIGURED";
        }
        if (error instanceof AiPromptBudgetExceededException) {
            return "AI_PROMPT_MANDATORY_SECTION_TOO_LARGE";
        }
        return error instanceof ClientDisconnectedException ? "AI_CANCELLED" : "AI_UPSTREAM_UNAVAILABLE";
    }

    private static String providerStatusOf(final RuntimeException error) {
        if (error instanceof AiUpstreamException upstream && upstream.providerStatus() != null) {
            return String.valueOf(upstream.providerStatus());
        }
        return "N/A";
    }

    private static void send(final SseEmitter emitter, final AiCancellationToken cancellation,
                             final String event, final Object body) {
        if (cancellation.isCancelled()) {
            throw new ClientDisconnectedException();
        }
        try {
            emitter.send(SseEmitter.event().name(event).data(body));
        } catch (final IOException | IllegalStateException error) {
            throw new ClientDisconnectedException();
        }
    }
    private static final class ClientDisconnectedException extends RuntimeException {
    }
}
