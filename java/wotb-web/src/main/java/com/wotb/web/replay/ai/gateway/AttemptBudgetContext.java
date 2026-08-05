package com.wotb.web.replay.ai.gateway;

import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;

import okhttp3.Call;

/**
 * Per-attempt budget state shared between the okhttp interceptor, the total
 * budget watchdog and the gateway retry loop.
 *
 * <p>The {@link Call} reference stays set for the whole
 * {@code chatModel.call(prompt)} lifecycle (connect, request send, response
 * wait, response body read and SDK JSON deserialization); it is only cleared
 * by the attempt's outer finally. The interceptor must not clear it.</p>
 */
final class AttemptBudgetContext {

    private final AtomicReference<Call> callRef = new AtomicReference<>();
    private final AtomicBoolean expired = new AtomicBoolean();

    void capture(final Call call) {
        callRef.set(call);
    }

    boolean isExpired() {
        return expired.get();
    }

    /**
     * Marks the budget as expired and cancels the in-flight {@link Call} if one
     * has been captured yet. Safe when the watchdog fires before the interceptor
     * captures the Call: the interceptor re-checks {@link #isExpired()} and
     * cancels immediately.
     */
    void expireAndCancel() {
        if (expired.compareAndSet(false, true)) {
            final Call call = callRef.get();
            if (call != null) {
                call.cancel();
            }
        }
    }

    void clear() {
        callRef.set(null);
    }
}
