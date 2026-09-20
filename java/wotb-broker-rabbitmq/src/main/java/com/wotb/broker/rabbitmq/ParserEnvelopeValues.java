package com.wotb.broker.rabbitmq;

/** Shared validation helpers for the parser wire envelopes. */
final class ParserEnvelopeValues {

    private ParserEnvelopeValues() {
    }

    /** Requires a non-blank envelope text field. */
    static String text(final String name, final String value) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must not be blank");
        }
        return value;
    }

    /** Requires a non-null envelope value. */
    static <T> T reference(final String name, final T value) {
        if (value == null) {
            throw new IllegalArgumentException(name + " must not be null");
        }
        return value;
    }

    /** Requires an attempt counter that starts at one; zero or negative attempts are meaningless. */
    static int attempt(final int attempt) {
        if (attempt < 1) {
            throw new IllegalArgumentException("attempt must be at least 1: " + attempt);
        }
        return attempt;
    }
}
