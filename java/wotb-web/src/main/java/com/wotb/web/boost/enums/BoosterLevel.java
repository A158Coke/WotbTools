package com.wotb.web.boost.enums;

/** 打手等级。 */
public enum BoosterLevel {
    CASUAL,
    SKILLED,
    ELITE,
    PRO,
    MASTER,
    AVERAGE_GOD;

    /** 场均神只能由管理员编辑已有打手档案时授予。 */
    public boolean canBeSelectedOnCreate() {
        return this != AVERAGE_GOD;
    }

    public static BoosterLevel from(final String value) {
        for (final BoosterLevel l : values()) {
            if (l.name().equalsIgnoreCase(value)) {
                return l;
            }
        }
        throw new IllegalArgumentException("UNKNOWN_BOOSTER_LEVEL");
    }
}
