package com.wotb.web.admin.exception;

/** 管理员 API 冲突（409）。 */
public class AdminConflictException extends RuntimeException {
    private final String errorCode;
    public AdminConflictException(final String errorCode, final String message) {
        super(message);
        this.errorCode = errorCode;
    }
    public String getErrorCode() { return errorCode; }
}
