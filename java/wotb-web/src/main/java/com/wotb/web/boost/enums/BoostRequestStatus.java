package com.wotb.web.boost.enums;

/** Boost request lifecycle. Database stores English enum names. */
public enum BoostRequestStatus {
    NEW("NEW"),
    REVIEWING("REVIEWING"),
    MATCHED("MATCHED"),
    ACCEPTED("ACCEPTED"),
    IN_PROGRESS("IN_PROGRESS"),
    PENDING_CONFIRM("PENDING_CONFIRM"),
    CLOSED("CLOSED"),
    EXCEPTION("EXCEPTION"),
    REJECTED("REJECTED"),
    CANCELLED("CANCELLED");

    private final String label;

    BoostRequestStatus(final String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }

    public static BoostRequestStatus from(final String value) {
        for (final BoostRequestStatus s : values()) {
            if (s.name().equalsIgnoreCase(value)) {
                return s;
            }
        }
        throw new IllegalArgumentException("UNKNOWN_BOOST_REQUEST_STATUS: " + value);
    }
}
