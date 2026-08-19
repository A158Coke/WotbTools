package com.wotb.web.boost.enums;

/** 打手业务状态。 */
public enum BoosterStatus {
    ACTIVE,
    INACTIVE,
    BANNED;

    public static BoosterStatus from(final String value) {
        for (final BoosterStatus s : values()) {
            if (s.name().equalsIgnoreCase(value)) {
                return s;
            }
        }
        throw new IllegalArgumentException("UNKNOWN_BOOSTER_STATUS");
    }
}
