package com.wotb.web.util;

public final class ConstraintViolations {

    private ConstraintViolations() {
    }

    public static boolean causedByConstraint(final Throwable failure, final String constraintName) {
        Throwable current = failure;
        while (current != null) {
            final String message = current.getMessage();
            if (message != null && message.contains(constraintName)) {
                return true;
            }
            current = current.getCause();
        }
        return false;
    }
}
