package com.wotb.ai.gateway;

import org.springframework.util.StringUtils;

/** Shared formatter for structured AI service events. */
public final class AiEventLog {

    private AiEventLog() {
    }

    /** Current request correlation ID, or {@code -} outside a request context. */
    public static String correlationId() {
        final String cid = AiRequestContext.correlationId();
        return StringUtils.hasText(cid) ? cid : "-";
    }

    /** Formats an event name, correlation ID, and flat key/value metadata. */
    public static String line(final String event, final String correlationId, final Object... kv) {
        final StringBuilder sb = new StringBuilder("event=").append(event);
        sb.append(" correlationId=").append(StringUtils.hasText(correlationId) ? correlationId : correlationId());
        for (int i = 0; i + 1 < kv.length; i += 2) {
            sb.append(' ').append(kv[i]).append('=').append(kv[i + 1]);
        }
        return sb.toString();
    }
}
