package com.wotb.ai.gateway;

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

    public static void setOverallDeadline(final long overallDeadlineNanos) {
        OVERALL_DEADLINE.set(overallDeadlineNanos);
    }

    public static void clearOverallDeadline() {
        OVERALL_DEADLINE.remove();
    }

    public static Long overallDeadlineNanos() {
        return OVERALL_DEADLINE.get();
    }
}
