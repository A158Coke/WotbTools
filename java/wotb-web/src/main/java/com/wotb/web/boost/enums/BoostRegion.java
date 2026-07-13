package com.wotb.web.boost.enums;

/** 服务区域。Phase 1 仅支持国服。 */
public enum BoostRegion {
    CN;

    public static BoostRegion from(final String value) {
        for (final BoostRegion r : values()) {
            if (r.name().equalsIgnoreCase(value)) {
                return r;
            }
        }
        throw new IllegalArgumentException("UNSUPPORTED_BOOST_REGION");
    }
}
