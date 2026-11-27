package com.wotb.web.aireviewfeedback.dto;

public enum FeedbackStatus {
    PENDING,
    FIXED;

    public static FeedbackStatus from(final String value) {
        if (value == null) {
            throw new IllegalArgumentException("INVALID_FEEDBACK_STATUS");
        }
        try {
            return valueOf(value);
        } catch (final IllegalArgumentException ex) {
            throw new IllegalArgumentException("INVALID_FEEDBACK_STATUS");
        }
    }
}
