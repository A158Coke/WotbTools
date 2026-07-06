package com.wotb.web.boost.enums;

import java.util.Arrays;

public enum BoosterAvailabilityTier {
    YEAR_360,
    QUARTER_80,
    MONTH_20,
    WEEK_5,
    WEEK_4,
    WEEK_3,
    WEEK_1;

    public static BoosterAvailabilityTier from(final String value) {
        return Arrays.stream(values())
                .filter(tier -> tier.name().equalsIgnoreCase(value))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("UNKNOWN_AVAILABILITY_TIER"));
    }
}
