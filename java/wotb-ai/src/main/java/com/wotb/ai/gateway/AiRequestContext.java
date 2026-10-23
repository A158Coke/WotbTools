package com.wotb.ai.gateway;

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
    private static final ThreadLocal<UsageTotals> USAGE = new ThreadLocal<>();
    private static final ThreadLocal<Long> OVERALL_DEADLINE = new ThreadLocal<>();

    private AiRequestContext() {
    }

    public static void set(final String correlationId, final AiCancellationToken cancellation) {
        CORRELATION_ID.set(correlationId);
        USAGE.set(new UsageTotals());
        CANCELLATION.set(cancellation);
    }

    public static void clear() {
        CORRELATION_ID.remove();
        USAGE.remove();
        CANCELLATION.remove();
        OVERALL_DEADLINE.remove();
    }

    public static String correlationId() {
        return CORRELATION_ID.get();
    }

    public static AiCancellationToken cancellationToken() {
        return CANCELLATION.get();
    }

    /** Request-local totals include every transport attempt, including failed attempts. */
    public static UsageTotals usageTotals() {
        return USAGE.get();
    }

    public static final class UsageTotals {
        public long inputTokens;
        public long outputTokens;
        public long totalTokens;
        public int calls;
        public int missingUsageCalls;

        public void add(final int input, final int output, final int total, final boolean missing) {
            calls++;
            inputTokens += input;
            outputTokens += output;
            totalTokens += total;
            missingUsageCalls += missing ? 1 : 0;
        }
    }

    /**
     * Sets the request overall deadline (nanos) computed at submission time.
     * The AI review worker wrapper sets it around the task; the services then
     * count queue wait against the shared budget.
     */
    public static void setOverallDeadline(final long overallDeadlineNanos) {
        OVERALL_DEADLINE.set(overallDeadlineNanos);
    }

    public static void clearOverallDeadline() {
        OVERALL_DEADLINE.remove();
    }

    /** Overall deadline (nanos) or {@code null} when not set (e.g. direct service calls). */
    public static Long overallDeadlineNanos() {
        return OVERALL_DEADLINE.get();
    }
}
