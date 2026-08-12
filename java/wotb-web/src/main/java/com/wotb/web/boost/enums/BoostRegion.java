package com.wotb.web.boost.enums;

/** 陪练需求支持的 WoTB 服务区域。 */
public enum BoostRegion {
    CN,
    ASIA,
    EU,
    NA;

    public static BoostRegion from(final String value) {
        for (final BoostRegion r : values()) {
            if (r.name().equalsIgnoreCase(value)) {
                return r;
            }
        }
        throw new IllegalArgumentException("UNSUPPORTED_BOOST_REGION");
    }
}
