package com.wotb.ai.gateway;

import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.ai.chat.model.ChatModel;

import java.util.function.LongSupplier;

/** Single owner for the gateway's configuration and per-call transport seams. */
final class AiGatewayRuntimeState {
    static final String PROVIDER_NAME = "DeepSeek";
    static final long DEFAULT_CALL_TIMEOUT_NANOS = 315_000_000_000L;
    volatile ChatModel chatModel;
    final String defaultModel;
    final MeterRegistry meterRegistry;
    final AiRetryPolicy retryPolicy;
    final long callTimeoutNanos;
    final LongSupplier nanoTimeSource;
    final BudgetSleeper sleeper;
    final ThreadLocal<AttemptBudgetContext> activeContext = new ThreadLocal<>();
    AttemptStartHook attemptStartHook = context -> { };

    AiGatewayRuntimeState(final ChatModel chatModel, final String defaultModel,
                          final MeterRegistry meterRegistry, final AiRetryPolicy retryPolicy,
                          final long callTimeoutNanos, final LongSupplier nanoTimeSource,
                          final BudgetSleeper sleeper) {
        this.chatModel = chatModel;
        this.defaultModel = defaultModel;
        this.meterRegistry = meterRegistry;
        this.retryPolicy = retryPolicy != null ? retryPolicy : AiRetryPolicy.DEFAULT;
        this.callTimeoutNanos = callTimeoutNanos > 0
                ? callTimeoutNanos : DEFAULT_CALL_TIMEOUT_NANOS;
        this.nanoTimeSource = nanoTimeSource != null ? nanoTimeSource : System::nanoTime;
        this.sleeper = sleeper != null ? sleeper : Thread::sleep;
    }
}

@FunctionalInterface
interface BudgetSleeper {
    void sleep(long millis) throws InterruptedException;
}

@FunctionalInterface
interface AttemptStartHook {
    void beforeAttempt(AttemptBudgetContext context);
}
