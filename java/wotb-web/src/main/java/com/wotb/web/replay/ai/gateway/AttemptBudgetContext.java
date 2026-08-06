package com.wotb.web.replay.ai.gateway;

/**
 * Per-attempt budget state shared between the okhttp interceptor, the total
 * budget watchdog, the external cancellation token and the gateway retry loop.
 *
 * <p>The {@code okhttp3.Call} reference stays set for the whole
 * {@code chatModel.call(prompt)} lifecycle (connect, request send, response
 * wait, response body read and SDK JSON deserialization); it is only cleared
 * by the attempt's outer finally. The interceptor must not clear it.</p>
 */
final class AttemptBudgetContext {

    private final AiCancellationToken cancellation;
    private final java.util.concurrent.atomic.AtomicReference<okhttp3.Call> callRef =
            new java.util.concurrent.atomic.AtomicReference<>();
    private final java.util.concurrent.atomic.AtomicBoolean expired =
            new java.util.concurrent.atomic.AtomicBoolean();

    AttemptBudgetContext(final AiCancellationToken cancellation) {
        this.cancellation = cancellation;
    }

    AttemptBudgetContext() {
        this(null);
    }

    void capture(final okhttp3.Call call) {
        callRef.set(call);
    }

    boolean isExpired() {
        return expired.get();
    }

    boolean isCancelled() {
        return cancellation != null && cancellation.isCancelled();
    }

    boolean isStopped() {
        return isExpired() || isCancelled();
    }

    /**
     * Marks the budget as expired and cancels the in-flight call if one
     * has been captured yet. Safe when the watchdog fires before the interceptor
     * captures the call: the interceptor re-checks {@link #isStopped()} and
     * cancels immediately.
     */
    void expireAndCancel() {
        if (expired.compareAndSet(false, true)) {
            cancelCall();
        }
    }

    /**
     * Cancels the in-flight call without marking the budget as expired. Used by
     * the external cancellation token when the client aborts mid-request.
     */
    void cancelCall() {
        final okhttp3.Call call = callRef.get();
        if (call != null) {
            call.cancel();
        }
    }

    void clear() {
        callRef.set(null);
    }
}
