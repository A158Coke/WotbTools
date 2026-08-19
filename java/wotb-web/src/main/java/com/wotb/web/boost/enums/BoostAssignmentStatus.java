package com.wotb.web.boost.enums;

/** Boost assignment lifecycle. Database stores English enum names. */
public enum BoostAssignmentStatus {
    ASSIGNED,
    ACCEPTED,
    IN_PROGRESS,
    PENDING_CONFIRM,
    DECLINED,
    CANCELLED,
    COMPLETED,
    EXCEPTION;

    public static BoostAssignmentStatus from(final String value) {
        for (final BoostAssignmentStatus s : values()) {
            if (s.name().equalsIgnoreCase(value)) {
                return s;
            }
        }
        throw new IllegalArgumentException("UNKNOWN_BOOST_ASSIGNMENT_STATUS: " + value);
    }
}
