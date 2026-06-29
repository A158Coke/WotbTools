package com.wotb.web.boost.enums;

/** 打手业务状态。 */
public enum BoosterStatus {
    ACTIVE("正常"),
    INACTIVE("停用"),
    BANNED("禁用");

    private final String label;

    BoosterStatus(final String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }

    public static BoosterStatus from(final String value) {
        for (final BoosterStatus s : values()) {
            if (s.name().equalsIgnoreCase(value)) {
                return s;
            }
        }
        throw new IllegalArgumentException("未知打手状态: " + value);
    }
}
