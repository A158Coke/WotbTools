package com.wotb.web.sitefeedback.dto;

public enum SiteFeedbackStatus {
    PENDING,
    FIXED;

    public static SiteFeedbackStatus from(final String value) {
        if (value == null) {
            throw new IllegalArgumentException("INVALID_SITE_FEEDBACK_STATUS");
        }
        try {
            return valueOf(value);
        } catch (final IllegalArgumentException ex) {
            throw new IllegalArgumentException("INVALID_SITE_FEEDBACK_STATUS");
        }
    }
}
