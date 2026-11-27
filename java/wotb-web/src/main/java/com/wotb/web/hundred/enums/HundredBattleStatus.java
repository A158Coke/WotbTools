package com.wotb.web.hundred.enums;

public enum HundredBattleStatus {

    PENDING,
    CURRENT,
    SUPERSEDED,
    REJECTED,
    CANCELLED,
    DELETED;

    public static HundredBattleStatus from(final String value) {
        if (value == null) {
            throw new IllegalArgumentException("INVALID_HUNDRED_STATUS");
        }
        try {
            return valueOf(value);
        } catch (final IllegalArgumentException e) {
            throw new IllegalArgumentException("INVALID_HUNDRED_STATUS");
        }
    }
}
