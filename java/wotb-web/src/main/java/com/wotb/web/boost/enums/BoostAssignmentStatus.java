package com.wotb.web.boost.enums;

/** Boost assignment lifecycle. Database stores English enum names. */
public enum BoostAssignmentStatus {
    ASSIGNED("ASSIGNED"),
    ACCEPTED("ACCEPTED"),
    IN_PROGRESS("IN_PROGRESS"),
    PENDING_CONFIRM("PENDING_CONFIRM"),
    DECLINED("DECLINED"),
    CANCELLED("CANCELLED"),
    COMPLETED("COMPLETED"),
    EXCEPTION("EXCEPTION");

    private final String label;

    BoostAssignmentStatus(final String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }

    public static BoostAssignmentStatus from(final String value) {
        for (final BoostAssignmentStatus s : values()) {
            if (s.name().equalsIgnoreCase(value)) {
                return s;
            }
        }
        throw new IllegalArgumentException("UNKNOWN_BOOST_ASSIGNMENT_STATUS: " + value);
    }
}
