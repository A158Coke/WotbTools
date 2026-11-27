package com.wotb.ai.gateway;

import com.openai.errors.OpenAIException;
import com.wotb.core.replay.processing.AiNotConfiguredException;
import io.micrometer.core.instrument.Timer;
import org.springframework.ai.chat.model.ChatResponse;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.util.StringUtils;

import java.util.UUID;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.atomic.AtomicReference;
final class AiGatewayStreamExecutor {
    private final AiGatewayRuntimeState state;
    private final AiGatewayMetrics metrics;
    private final AiGatewayFailurePolicy failurePolicy;
    private final AiGatewayResponseMapper responseMapper;
    private final AiGatewayLifecycle lifecycle;

    AiGatewayStreamExecutor(final AiGatewayRuntimeState state, final AiGatewayMetrics metrics,
                            final AiGatewayFailurePolicy failurePolicy,
                            final AiGatewayResponseMapper responseMapper,
                            final AiGatewayLifecycle lifecycle) {
        this.state = state;
        this.metrics = metrics;
        this.failurePolicy = failurePolicy;
        this.responseMapper = responseMapper;
        this.lifecycle = lifecycle;
    }

    AiChatResponse stream(final AiChatRequest request, final StreamConsumer consumer) {
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
            final AtomicReference<ChatResponse> receivedUsage = new AtomicReference<>();
            final AiRequestContext.UsageTotals reviewUsage = AiRequestContext.usageTotals();
            try {
                state.attemptStartHook.beforeAttempt(context);
                failurePolicy.logUpstreamStarted(request, model, correlationId, 1,
                        Math.max(0L, deadlineNanos - state.nanoTimeSource.getAsLong()));
                final long attemptStartNanos = state.nanoTimeSource.getAsLong();
                final StringBuilder text = new StringBuilder();
                final AtomicReference<ChatResponse> lastResponse = new AtomicReference<>();
                state.chatModel.stream(prompt)
                        .doOnNext(response -> {
                            if (responseMapper.hasReceivedUsage(response)) {
                                responseMapper.recordReceivedUsage(response, request.analysisMode(), correlationId, reviewUsage,
                                        receivedUsage.getAndSet(response));
                            }
                            if (context.isExpired()
                                    || state.nanoTimeSource.getAsLong() >= deadlineNanos) {
                                throw new StreamInterruptedMarker("AI_TIMEOUT");
                            }
                            if (context.isCancelled()) {
                                throw new StreamInterruptedMarker("AI_CANCELLED");
                            }
                            final String delta = AiGatewayResponseMapper.streamDelta(response);
                            if (StringUtils.hasText(delta)) {
                                text.append(delta);
                                try {
                                    if (delta.length() > AiGatewayStreamChunker.CHUNK_SPLIT_THRESHOLD) {
                                        for (final String piece : AiGatewayStreamChunker.splitChunks(delta, AiGatewayStreamChunker.CHUNK_MAX_PIECE)) {
                                            if (context.isExpired()
                                                    || state.nanoTimeSource.getAsLong() >= deadlineNanos) {
                                                throw new StreamInterruptedMarker("AI_TIMEOUT");
                                            }
                                            if (context.isCancelled()) {
                                                throw new StreamInterruptedMarker("AI_CANCELLED");
                                            }
                                            consumer.onDelta(piece);
                                            AiGatewayStreamChunker.pauseBetweenPieces();
                                        }
                                    } else {
                                        consumer.onDelta(delta);
                                    }
                                } catch (final StreamInterruptedMarker marker) {
                                    throw marker;
                                } catch (final RuntimeException sinkError) {
                                    throw new ConsumerAbortException(sinkError);
                                }
                            }
                            lastResponse.set(response);
                        })
                        .blockLast();
                if (context.isExpired() || state.nanoTimeSource.getAsLong() >= deadlineNanos) {
                    throw new AiUpstreamException("AI_TIMEOUT", null, correlationId);
                }
                if (context.isCancelled()) {
                    throw new AiUpstreamException("AI_CANCELLED", null, correlationId);
                }
                if (text.isEmpty()) {
                    throw failurePolicy.providerFailure(null, "AI_EMPTY_RESPONSE", request.analysisMode(),
                            correlationId, "blank streaming completion content");
                }
                final ChatResponse aggregated =
                        AiGatewayResponseMapper.toAggregatedResponse(text.toString(), lastResponse.get(), model);
                if (metricsEnabled) {
                    metrics.meterRegistry.counter(AiGatewayMetrics.SUCCESS, "mode", request.analysisMode()).increment();
                    metrics.recordUsageMetrics(aggregated, request.analysisMode());
                    metrics.recordRetryOutcome(request.analysisMode(), "no_retry");
                }
                final AiChatResponse streamResult = responseMapper.toResponse(aggregated, request, model, correlationId);
                failurePolicy.logUpstreamCompleted(correlationId, 1, attemptStartNanos, streamResult);
                return streamResult;
            } catch (final AiUpstreamException e) {
                throw metrics.finishFailure(e, retryCount, request, failurePolicy);
            } catch (final StreamInterruptedMarker marker) {
                throw metrics.finishFailure(new AiUpstreamException(
                        marker.code, null, correlationId, marker), retryCount, request, failurePolicy);
            } catch (final ConsumerAbortException abort) {
                throw abort.getCause();
            } catch (final OpenAIException e) {
                final AiUpstreamException failure = new AiUpstreamException(
                        failurePolicy.classify(e), failurePolicy.providerStatus(e), correlationId, e);
                failurePolicy.logProviderFailure(e, failure.code(), request.analysisMode(), correlationId);
                throw metrics.finishFailure(failurePolicy.resolveStopped(failure, context, correlationId),
                        retryCount, request, failurePolicy);
            } catch (final RuntimeException e) {
                if (context.isCancelled()) {
                    throw metrics.finishFailure(new AiUpstreamException(
                            "AI_CANCELLED", null, correlationId, e), retryCount, request, failurePolicy);
                }
                if (context.isExpired()) {
                    throw metrics.finishFailure(new AiUpstreamException(
                            "AI_TIMEOUT", null, correlationId, e), retryCount, request, failurePolicy);
                }
                throw metrics.finishFailure(new AiUpstreamException(
                        "AI_UPSTREAM_UNAVAILABLE", failurePolicy.nestedProviderStatus(e), correlationId, e),
                        retryCount, request, failurePolicy);
            } finally {
                if (receivedUsage.get() == null) {
                    responseMapper.recordReceivedUsage(null, request.analysisMode(), correlationId);
                }
                watchdog.cancel(false);
                if (cancellation != null) {
                    cancellation.detach(context);
                }
                context.clear();
                state.activeContext.remove();
            }
        } finally {
            if (upstreamSample != null) {
                metrics.stopDuration(upstreamSample);
            }
        }
    }

    private static final class StreamInterruptedMarker extends RuntimeException {
        private final String code;

        StreamInterruptedMarker(final String code) {
            super(code);
            this.code = code;
        }
    }

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
