package com.wotb.ai.gateway;

final class AttemptBudgetContext {

    private final AiCancellationToken cancellation;
    private final java.util.concurrent.atomic.AtomicReference<okhttp3.Call> callRef =
            new java.util.concurrent.atomic.AtomicReference<>();
    private final java.util.concurrent.atomic.AtomicBoolean expired =
            new java.util.concurrent.atomic.AtomicBoolean();

    AttemptBudgetContext(final AiCancellationToken cancellation) {
        this.cancellation = cancellation;
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

    void expireAndCancel() {
        if (expired.compareAndSet(false, true)) {
            cancelCall();
        }
    }

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
