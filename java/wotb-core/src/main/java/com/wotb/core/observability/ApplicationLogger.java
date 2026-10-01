package com.wotb.core.observability;

import org.slf4j.Logger;
import org.slf4j.event.Level;
import org.slf4j.spi.LoggingEventBuilder;

import java.util.IdentityHashMap;
import java.util.Map;

/** Shared event boundary; diagnostics belong in structured fields, never payloads. */
public final class ApplicationLogger {
    private ApplicationLogger() { }

    public static LoggingEventBuilder event(final Logger logger, final Level level, final String event) {
        if (event == null || !event.matches("[a-z][a-z0-9_.]{0,95}")) {
            throw new IllegalArgumentException("Invalid application log event");
        }
        return logger.atLevel(level).addKeyValue("event", event);
    }

    /** For payload-bearing parser/upstream errors: preserve diagnostic topology, never raw messages. */
    public static Throwable diagnosticCause(final Throwable failure) {
        return copyCause(failure, new IdentityHashMap<>());
    }

    private static Throwable copyCause(final Throwable failure, final Map<Throwable, Throwable> seen) {
        if (failure == null) return null;
        final Throwable existing = seen.get(failure);
        if (existing != null) return existing;
        final Throwable safe = new Throwable(failure.getClass().getName());
        seen.put(failure, safe);
        safe.setStackTrace(failure.getStackTrace());
        final Throwable cause = copyCause(failure.getCause(), seen);
        if (cause != null && cause != safe) safe.initCause(cause);
        for (final Throwable suppressed : failure.getSuppressed()) {
            final Throwable redacted = copyCause(suppressed, seen);
            if (redacted != safe) safe.addSuppressed(redacted);
        }
        return safe;
    }
}
