package com.wotb.web.mark3.enums;

/** 名人堂「三环」submission 状态；三环记录没有 SUPERSEDED。 */
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
