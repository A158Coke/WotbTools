package com.wotb.web.boost.enums;

/** 服务区域。Phase 1 仅支持国服。 */
public enum BoostRegion {
    CN("国服");

    private final String label;

    BoostRegion(final String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }

    public static BoostRegion from(final String value) {
        for (final BoostRegion r : values()) {
            if (r.name().equalsIgnoreCase(value)) {
                return r;
            }
        }
        throw new IllegalArgumentException("当前仅支持国服 (CN)。");
    }
}
