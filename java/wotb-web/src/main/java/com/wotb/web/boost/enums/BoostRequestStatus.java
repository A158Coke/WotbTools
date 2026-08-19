package com.wotb.web.boost.enums;

/** Boost request lifecycle. Database stores English enum names. */
public enum BoostRequestStatus {
    NEW,
    REVIEWING,
    MATCHED,
    ACCEPTED,
    IN_PROGRESS,
    PENDING_CONFIRM,
    CLOSED,
    EXCEPTION,
    REJECTED,
    CANCELLED;

    public static BoostRequestStatus from(final String value) {
        for (final BoostRequestStatus s : values()) {
            if (s.name().equalsIgnoreCase(value)) {
                return s;
            }
        }
        throw new IllegalArgumentException("UNKNOWN_BOOST_REQUEST_STATUS: " + value);
    }
}
