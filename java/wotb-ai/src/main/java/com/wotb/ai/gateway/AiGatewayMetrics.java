package com.wotb.ai.gateway;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import org.springframework.ai.chat.metadata.Usage;
import org.springframework.ai.chat.model.ChatResponse;

final class AiGatewayMetrics {
    static final long NANOS_PER_MILLI = 1_000_000L;
    static final String REQUESTS = "wotb_ai_upstream_requests_total";
    static final String SUCCESS = "wotb_ai_upstream_success_total";
    static final String ERRORS = "wotb_ai_upstream_errors_total";
    static final String DURATION = "wotb_ai_upstream_duration_seconds";
    static final String RETRIES = "wotb_ai_upstream_retries_total";
    static final String RETRY_OUTCOME = "wotb_ai_upstream_retry_outcome_total";
    static final String TOKENS = "wotb_ai_upstream_tokens_total";
    final MeterRegistry meterRegistry;
    private final Timer duration;

    AiGatewayMetrics(final MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
        this.duration = meterRegistry == null ? null : Timer.builder(DURATION)
                .description("AI upstream API call duration (including retries)")
                .publishPercentileHistogram()
                .register(meterRegistry);
    }

    Timer.Sample startDuration() {
        return meterRegistry == null ? null : Timer.start(meterRegistry);
    }

    void stopDuration(final Timer.Sample sample) {
        if (sample != null) {
            sample.stop(duration);
        }
    }

    void recordUsageMetrics(final ChatResponse response, final String mode) {
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
        recordTokens(mode, "reasoning", AiGatewayResponseMapper.reasoningTokens(usage));
        recordTokens(mode, "cache_hit", AiGatewayResponseMapper.cacheHitTokens(usage));
        recordTokens(mode, "cache_miss", AiGatewayResponseMapper.cacheMissTokens(usage));
    }

    private void recordTokens(final String mode, final String tokenType, final int value) {
        if (value > 0) {
            meterRegistry.counter(TOKENS, "mode", mode, "token_type", tokenType)
                    .increment(value);
        }
    }

    void recordRetryOutcome(final String mode, final String outcome) {
        meterRegistry.counter(RETRY_OUTCOME, "mode", mode, "outcome", outcome).increment();
    }

    AiUpstreamException finishFailure(final AiUpstreamException failure, final int retryCount,
                                      final AiChatRequest request,
                                      final AiGatewayFailurePolicy failurePolicy) {
        if (meterRegistry != null) {
            meterRegistry.counter(ERRORS, "type", failure.code()).increment();
            recordRetryOutcome(request.analysisMode(),
                    retryCount == 0 ? "no_retry" : "failure_after_retry");
        }
        failurePolicy.logUpstreamFailed(request, failure, retryCount + 1);
        return failure;
    }

}
