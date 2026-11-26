package com.wotb.web.util;

public enum ErrorCode {

    CONFIRMATION_REQUIRED("Deletion requires confirm=true."),
    CANNOT_DELETE_SELF("You cannot delete your own admin account."),
    USER_HAS_DEPENDENCIES("User has related records and cannot be deleted directly."),
    FAILED_LOCAL_DELETE("Local user profile could not be deleted."),
    FAILED_KEYCLOAK_DELETE("Local profile was deleted, but Keycloak user deletion failed."),
    KEYCLOAK_USER_NOT_FOUND("Keycloak user was not found."),
    BULK_LIMIT_EXCEEDED("Too many ids in a single delete request."),
    INVALID_USER_SEGMENT("Unknown admin user list segment."),
    IDP_FILTER_REQUIRES_KEYCLOAK_SEGMENT("Identity provider filter requires the keycloak segment.");

    private final String defaultMessage;

    ErrorCode(final String defaultMessage) {
        this.defaultMessage = defaultMessage;
    }

    public String getDefaultMessage() {
        return defaultMessage;
    }
}
