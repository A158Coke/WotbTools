package com.wotb.web.mark3.enums;

public enum Mark3Status {

    PENDING,
    CURRENT,
    REJECTED,
    CANCELLED,
    DELETED;

    public static Mark3Status from(final String value) {
        if (value == null) {
            throw new IllegalArgumentException("INVALID_MARK3_STATUS");
        }
        try {
            return valueOf(value);
        } catch (final IllegalArgumentException e) {
            throw new IllegalArgumentException("INVALID_MARK3_STATUS");
        }
    }
}
