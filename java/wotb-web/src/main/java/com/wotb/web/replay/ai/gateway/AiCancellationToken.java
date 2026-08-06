package com.wotb.web.replay.ai.gateway;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Per-request cancellation signal shared between the analyze HTTP request and
 * the in-flight AI upstream call.
 *
 * <p>When the client aborts (cancel button, page navigation, client timeout),
 * the cancel endpoint flips this token; the gateway then cancels the captured
 * okhttp {@code Call} immediately (no further tokens are consumed) and stops
 * the retry loop with a stable {@code AI_CANCELLED} error.</p>
 */
public final class AiCancellationToken {

    private final AtomicBoolean cancelled = new AtomicBoolean();
    private final AtomicReference<AttemptBudgetContext> activeContext = new AtomicReference<>();

    boolean isCancelled() {
        return cancelled.get();
    }

    /**
     * Marks the request as cancelled and cancels the in-flight upstream call if
     * one has been captured yet. Safe when cancellation arrives before the
     * interceptor captures the {@code Call}: the interceptor re-checks
     * {@link AttemptBudgetContext#isStopped()} and cancels immediately.
     *
     * @return {@code true} if this is the first cancellation
     */
    boolean cancel() {
        final boolean first = cancelled.compareAndSet(false, true);
        final AttemptBudgetContext context = activeContext.get();
        if (context != null) {
            context.cancelCall();
        }
        return first;
    }

    void attach(final AttemptBudgetContext context) {
        activeContext.set(context);
    }

    void detach(final AttemptBudgetContext context) {
        activeContext.compareAndSet(context, null);
    }
}
