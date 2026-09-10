package com.wotb.web.util;

/** 通用 API 错误码枚举。取代 ErrorCodes（JSON 加载类）。 */
public enum ErrorCode {

    CONFIRMATION_REQUIRED("Deletion requires confirm=true."),
    CANNOT_DELETE_SELF("You cannot delete your own admin account."),
    USER_HAS_DEPENDENCIES("User has related records and cannot be deleted directly."),
    BOOSTER_HAS_DEPENDENCIES("The booster has related records and cannot be deleted"),
    FAILED_LOCAL_DELETE("Local user profile could not be deleted."),
    FAILED_KEYCLOAK_DELETE("Local profile was deleted, but Keycloak user deletion failed."),
    KEYCLOAK_USER_NOT_FOUND("Keycloak user was not found."),
    /** 批量操作单次请求的 id 数超过上限。 */
    BULK_LIMIT_EXCEEDED("Too many ids in a single bulk request."),
    /** 管理员用户列表 segment 取值非法。 */
    INVALID_USER_SEGMENT("Unknown admin user list segment."),
    /** IdP 过滤是 Keycloak 侧能力，仅 keycloak segment 支持。 */
    IDP_FILTER_REQUIRES_KEYCLOAK_SEGMENT("Identity provider filter requires the keycloak segment.");

    private final String defaultMessage;

    ErrorCode(final String defaultMessage) {
        this.defaultMessage = defaultMessage;
    }

    public String getDefaultMessage() {
        return defaultMessage;
    }
}
