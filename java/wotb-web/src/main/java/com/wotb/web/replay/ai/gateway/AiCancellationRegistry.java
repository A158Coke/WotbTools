package com.wotb.web.replay.ai.gateway;

import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Component;

/**
 * Registry of in-flight AI Review requests keyed by correlation id, so the
 * cancel endpoint can abort an upstream call that the client no longer waits
 * for. This is what turns a client abort (navigation / cancel button / client
 * timeout) into an immediate upstream cancellation instead of a wasted,
 * fully-billed AI call.
 */
@Component
public class AiCancellationRegistry {

    private final ConcurrentHashMap<String, AiCancellationToken> active = new ConcurrentHashMap<>();

    /**
     * Registers a fresh token for {@code correlationId}. A second registration
     * for the same id reuses the existing token (idempotent).
     */
    public AiCancellationToken register(final String correlationId) {
        return active.computeIfAbsent(correlationId, key -> new AiCancellationToken());
    }

    /**
     * Cancels the in-flight request identified by {@code correlationId}.
     *
     * @return {@code true} if the request was registered (whether or not it was
     *         already cancelled)
     */
    public boolean cancel(final String correlationId) {
        final AiCancellationToken token = active.get(correlationId);
        if (token == null) {
            return false;
        }
        token.cancel();
        return true;
    }

    public void unregister(final String correlationId) {
        active.remove(correlationId);
    }
}
