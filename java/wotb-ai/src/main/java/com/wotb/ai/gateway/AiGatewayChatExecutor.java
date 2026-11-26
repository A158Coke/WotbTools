package com.wotb.ai.gateway;

import com.openai.errors.OpenAIException;
import com.wotb.core.replay.processing.AiNotConfiguredException;
import io.micrometer.core.instrument.Timer;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.util.StringUtils;

import java.util.UUID;
import java.util.concurrent.ScheduledFuture;

final class AiGatewayChatExecutor {
    private final AiGatewayRuntimeState state;
    private final AiGatewayMetrics metrics;
    private final AiGatewayFailurePolicy failurePolicy;
    private final AiGatewayResponseMapper responseMapper;
    private final AiGatewayLifecycle lifecycle;

    AiGatewayChatExecutor(final AiGatewayRuntimeState state, final AiGatewayMetrics metrics,
                          final AiGatewayFailurePolicy failurePolicy,
                          final AiGatewayResponseMapper responseMapper,
                          final AiGatewayLifecycle lifecycle) {
        this.state = state;
        this.metrics = metrics;
        this.failurePolicy = failurePolicy;
        this.responseMapper = responseMapper;
        this.lifecycle = lifecycle;
    }

    AiChatResponse chat(final AiChatRequest request) {
        if (state.chatModel == null) {
            throw new AiNotConfiguredException();
        }
        final String correlationId = StringUtils.hasText(request.correlationId())
                ? request.correlationId()
                : (StringUtils.hasText(AiRequestContext.correlationId())
                        ? AiRequestContext.correlationId() : UUID.randomUUID().toString());
        final AiCancellationToken cancellation = AiRequestContext.cancellationToken();
        final String model = StringUtils.hasText(request.model()) ? request.model() : state.defaultModel;
        final boolean metricsEnabled = state.meterRegistry != null;
        final Timer.Sample upstreamSample = metrics.startDuration();
        final Prompt prompt = responseMapper.buildPrompt(request, model);
        final long requestCallTimeoutNanos = request.callTimeoutSec() != null
                ? Math.min(request.callTimeoutSec() * 1_000_000_000L, state.callTimeoutNanos)
                : state.callTimeoutNanos;
        final long deadlineNanos = state.nanoTimeSource.getAsLong() + requestCallTimeoutNanos;
        int retryCount = 0;
        try {
            while (true) {
                final long remainingNanos = deadlineNanos - state.nanoTimeSource.getAsLong();
                if (remainingNanos <= 0) {
                    throw metrics.finishFailure(
                            new AiUpstreamException("AI_TIMEOUT", null, correlationId),
                            retryCount, request, failurePolicy);
                }
                if (cancellation != null && cancellation.isCancelled()) {
                    throw metrics.finishFailure(
                            new AiUpstreamException("AI_CANCELLED", null, correlationId),
                            retryCount, request, failurePolicy);
                }
                if (metricsEnabled) {
                    metrics.meterRegistry.counter(AiGatewayMetrics.REQUESTS, "mode", request.analysisMode()).increment();
                }
                final AttemptBudgetContext context = new AttemptBudgetContext(cancellation);
                if (cancellation != null) {
                    cancellation.attach(context);
                }
                state.activeContext.set(context);
                final ScheduledFuture<?> watchdog =
                        lifecycle.scheduleBudgetWatchdog(context, remainingNanos);
                AiUpstreamException failure = null;
                boolean usageRecorded = false;
                try {
                    state.attemptStartHook.beforeAttempt(context);
                    failurePolicy.logUpstreamStarted(request, model, correlationId, retryCount + 1,
                            Math.max(0L, deadlineNanos - state.nanoTimeSource.getAsLong()));
                    final long attemptStartNanos = state.nanoTimeSource.getAsLong();
                    final ChatResponse response = state.chatModel.call(prompt);
                    responseMapper.recordReceivedUsage(response, request.analysisMode(), correlationId);
                    usageRecorded = true;
                    final AiChatResponse result = responseMapper.toResponse(response, request, model, correlationId);
                    if (context.isExpired() || state.nanoTimeSource.getAsLong() >= deadlineNanos) {
                        failure = new AiUpstreamException("AI_TIMEOUT", null, correlationId);
                    } else if (context.isCancelled()) {
                        failure = new AiUpstreamException("AI_CANCELLED", null, correlationId);
                    } else {
                        if (metricsEnabled) {
                            metrics.meterRegistry.counter(AiGatewayMetrics.SUCCESS, "mode", request.analysisMode()).increment();
                            metrics.recordUsageMetrics(response, request.analysisMode());
                            metrics.recordRetryOutcome(request.analysisMode(),
                                    retryCount == 0 ? "no_retry" : "success_after_retry");
                        }
                        failurePolicy.logUpstreamCompleted(correlationId, retryCount + 1, attemptStartNanos, result);
                        return result;
                    }
                } catch (final AiUpstreamException e) {
                    failure = e;
                } catch (final IllegalArgumentException e) {
                    throw e;
                } catch (final OpenAIException e) {
                    failure = new AiUpstreamException(
                            failurePolicy.classify(e), failurePolicy.providerStatus(e), correlationId, e);
                    failurePolicy.logProviderFailure(e, failure.code(), request.analysisMode(), correlationId);
                } catch (final RuntimeException e) {
                    final Integer providerStatus = failurePolicy.nestedProviderStatus(e);
                    failure = new AiUpstreamException(
                            "AI_UPSTREAM_UNAVAILABLE", providerStatus, correlationId, e);
                    failurePolicy.logProviderFailure(providerStatus, failure.code(), request.analysisMode(),
                            correlationId, e.getClass().getSimpleName());
                } finally {
                    if (!usageRecorded) {
                        responseMapper.recordReceivedUsage(null, request.analysisMode(), correlationId);
                    }
                    watchdog.cancel(false);
                    if (cancellation != null) {
                        cancellation.detach(context);
                    }
                    context.clear();
                    state.activeContext.remove();
                }
                if (context.isCancelled()) {
                    failure = new AiUpstreamException("AI_CANCELLED", null, correlationId, failure);
                } else if (context.isExpired()) {
                    failure = new AiUpstreamException("AI_TIMEOUT", null, correlationId, failure);
                }
                final boolean lastAttempt = retryCount >= state.retryPolicy.maxAttempts() - 1;
                final long remainingAfterNanos = deadlineNanos - state.nanoTimeSource.getAsLong();
                if (!context.isStopped() && state.retryPolicy.isRetryable(failure)
                        && remainingAfterNanos <= 0) {
                    failure = new AiUpstreamException("AI_TIMEOUT", null, correlationId, failure);
                }
                if (!lastAttempt && !context.isStopped()
                        && state.retryPolicy.isRetryable(failure)) {
                    final long backoffMillis = state.retryPolicy.backoffMillis(retryCount + 1);
                    if (remainingAfterNanos <= backoffMillis * AiGatewayMetrics.NANOS_PER_MILLI) {
                        failure = new AiUpstreamException("AI_TIMEOUT", null, correlationId, failure);
                    } else {
                        retryCount++;
                        failurePolicy.logTransportRetry(request, correlationId, retryCount, failure, backoffMillis);
                        try {
                            sleepQuietly(backoffMillis, failure);
                        } catch (final AiUpstreamException interruptAbort) {
                            throw metrics.finishFailure(interruptAbort, retryCount, request, failurePolicy);
                        }
                        if (metricsEnabled) {
                            metrics.meterRegistry.counter(AiGatewayMetrics.RETRIES, "mode", request.analysisMode()).increment();
                        }
                        continue;
                    }
                }
                throw metrics.finishFailure(failure, retryCount, request, failurePolicy);
            }
        } finally {
            if (upstreamSample != null) {
                metrics.stopDuration(upstreamSample);
            }
        }
    }


    private void sleepQuietly(final long millis, final AiUpstreamException pending) {
        if (millis <= 0) {
            return;
        }
        try {
            state.sleeper.sleep(millis);
        } catch (final InterruptedException e) {
            Thread.currentThread().interrupt();
            throw pending;
        }
    }
}
