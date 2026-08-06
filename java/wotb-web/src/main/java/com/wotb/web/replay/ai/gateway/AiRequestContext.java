package com.wotb.web.replay.ai.gateway;

/**
 * Thread-local request context for the synchronous AI Review request thread:
 * the correlation id chosen by the controller and the cancellation token wired
 * to the cancel endpoint.
 *
 * <p>Set by {@code ReconstructionController} around the whole analyze call and
 * cleared in a {@code finally} block, so the gateway can reuse the correlation
 * id (instead of generating a fresh one) and abort the upstream call when the
 * client cancels. Direct gateway tests that do not set the context keep the
 * previous behavior (gateway-generated correlation id, no external
 * cancellation).</p>
 */
public final class AiRequestContext {

    private static final ThreadLocal<String> CORRELATION_ID = new ThreadLocal<>();
    private static final ThreadLocal<AiCancellationToken> CANCELLATION = new ThreadLocal<>();

    private AiRequestContext() {
    }

    public static void set(final String correlationId, final AiCancellationToken cancellation) {
        CORRELATION_ID.set(correlationId);
        CANCELLATION.set(cancellation);
    }

    public static void clear() {
        CORRELATION_ID.remove();
        CANCELLATION.remove();
    }

    public static String correlationId() {
        return CORRELATION_ID.get();
    }

    public static AiCancellationToken cancellationToken() {
        return CANCELLATION.get();
    }
}
