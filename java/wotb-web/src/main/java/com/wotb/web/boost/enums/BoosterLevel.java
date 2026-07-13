package com.wotb.web.boost.enums;

/** 打手等级。 */
public enum BoosterLevel {
    CASUAL,
    SKILLED,
    ELITE,
    PRO;

    public static BoosterLevel from(final String value) {
        for (final BoosterLevel l : values()) {
            if (l.name().equalsIgnoreCase(value)) {
                return l;
            }
        }
        throw new IllegalArgumentException("UNKNOWN_BOOSTER_LEVEL");
    }
}
