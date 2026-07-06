package com.wotb.web.boost.enums;

import java.util.Arrays;

public enum BoosterApplicationStatus {
    NEW,
    REVIEWING,
    APPROVED,
    REJECTED;

    public static BoosterApplicationStatus from(final String value) {
        return Arrays.stream(values())
                .filter(status -> status.name().equalsIgnoreCase(value))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("UNKNOWN_BOOSTER_APPLICATION_STATUS"));
    }
}
