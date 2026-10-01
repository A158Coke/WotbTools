package com.wotb.core.observability;

import org.slf4j.MDC;

import java.util.Map;
import java.util.UUID;

/** Captures submission-time MDC and restores worker context even after exceptions. */
public final class LogContext {
    private final Map<String, String> values;

    private LogContext(final Map<String, String> values) {
        this.values = values == null ? Map.of() : Map.copyOf(values);
    }

    public static LogContext capture() {
        return new LogContext(MDC.getCopyOfContextMap());
    }

    /** Bounded identifier only; never use inbound correlation metadata as identity. */
    public static String requestId(final String value) {
        if (value == null) return UUID.randomUUID().toString();
        final StringBuilder safe = new StringBuilder(Math.min(value.length(), 128));
        for (int index = 0; index < value.length() && safe.length() < 128; index++) {
            final char current = value.charAt(index);
            if (Character.isLetterOrDigit(current) || current == '-' || current == '_' || current == '.') {
                safe.append(current);
            }
        }
        return safe.isEmpty() ? UUID.randomUUID().toString() : safe.toString();
    }

    public Runnable wrap(final Runnable task) {
        return () -> {
            final LogContext previous = capture();
            install();
            try {
                task.run();
            } finally {
                previous.install();
            }
        };
    }

    public static Scope with(final String key, final String value) {
        final LogContext previous = capture();
        if (value == null) {
            MDC.remove(key);
        } else {
            MDC.put(key, value);
        }
        return previous::install;
    }

    private void install() {
        if (values.isEmpty()) {
            MDC.clear();
        } else {
            MDC.setContextMap(values);
        }
    }

    @FunctionalInterface
    public interface Scope extends AutoCloseable {
        @Override
        void close();
    }
}
