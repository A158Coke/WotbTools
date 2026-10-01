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

    public static void info(final Logger logger, final String event, final Object... fields) {
        log(logger, Level.INFO, event, null, fields);
    }

    public static void debug(final Logger logger, final String event, final Object... fields) {
        log(logger, Level.DEBUG, event, null, fields);
    }

    public static void warn(final Logger logger, final String event, final Object... fields) {
        log(logger, Level.WARN, event, null, fields);
    }

    public static void warn(final Logger logger, final String event, final Throwable failure, final Object... fields) {
        log(logger, Level.WARN, event, failure, fields);
    }

    public static void error(final Logger logger, final String event, final Throwable failure, final Object... fields) {
        log(logger, Level.ERROR, event, failure, fields);
    }

    private static void log(final Logger logger, final Level level, final String event,
                            final Throwable failure, final Object... fields) {
        if (fields.length % 2 != 0) throw new IllegalArgumentException("Log fields require key/value pairs");
        final LoggingEventBuilder builder = event(logger, level, event);
        for (int i = 0; i < fields.length; i += 2) {
            builder.addKeyValue(String.valueOf(fields[i]), fields[i + 1]);
        }
        // Internal exceptions retain their actual type, useful message and complete cause chain.
        if (failure != null) builder.setCause(failure);
        builder.log("event=" + event);
    }

    /** Explicit boundary for exceptions whose messages may contain raw replay/JSON payloads. */
    public static Throwable safePayloadThrowable(final Throwable failure) {
        return copyCause(failure, new IdentityHashMap<>());
    }

    /** Explicit boundary for HTTP/provider responses that may contain prompts, completions or credentials. */
    public static Throwable safeProviderThrowable(final Throwable failure) {
        return copyCause(failure, new IdentityHashMap<>());
    }

    private static Throwable copyCause(final Throwable failure, final Map<Throwable, Throwable> seen) {
        if (failure == null) return null;
        final Throwable existing = seen.get(failure);
        if (existing != null) return existing;
        final Throwable safe = new RedactedThrowable(failure.getClass().getName());
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

    private static final class RedactedThrowable extends Throwable {
        private final String originalType;

        private RedactedThrowable(final String originalType) {
            super(originalType + " [payload message redacted]");
            this.originalType = originalType;
        }

        @Override
        public String toString() { return originalType + ": " + getMessage(); }
    }
}
