package com.wotb.web.boost.enums;

/** 打手等级。 */
public enum BoosterLevel {
    CASUAL("普通"),
    SKILLED("熟练"),
    ELITE("高手"),
    PRO("职业级");

    private final String label;

    BoosterLevel(final String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }

    public static BoosterLevel from(final String value) {
        for (final BoosterLevel l : values()) {
            if (l.name().equalsIgnoreCase(value)) {
                return l;
            }
        }
        throw new IllegalArgumentException("未知打手等级: " + value);
    }
}
