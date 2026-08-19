package com.wotb.web.boost.enums;

/** 陪练需求类型。 */
public enum BoostRequestType {
    COACHING,
    RATING_IMPROVEMENT,
    MISSION,
    TANK_GRIND,
    RANKED,
    TOURNAMENT_TRAINING,
    OTHER;

    public static BoostRequestType from(final String value) {
        for (final BoostRequestType t : values()) {
            if (t.name().equalsIgnoreCase(value)) {
                return t;
            }
        }
        throw new IllegalArgumentException("UNKNOWN_BOOST_REQUEST_TYPE");
    }
}
