package com.wotb.web.admin;

/** 管理员 API 错误码。前端/后端共用。 */
public enum AdminErrorCode {

    CONFIRMATION_REQUIRED("Deletion requires confirm=true."),
    CANNOT_DELETE_SELF("You cannot delete your own admin account."),
    USER_HAS_DEPENDENCIES("User has related records and cannot be deleted directly."),
    FAILED_LOCAL_DELETE("Local user profile could not be deleted."),
    FAILED_KEYCLOAK_DELETE("Local profile was deleted, but Keycloak user deletion failed."),
    KEYCLOAK_USER_NOT_FOUND("Keycloak user was not found.");

    private final String defaultMessage;

    AdminErrorCode(final String defaultMessage) {
        this.defaultMessage = defaultMessage;
    }

    public String getDefaultMessage() {
        return defaultMessage;
    }
}
