package com.wotb.web.admin.exception;

/** 管理员 API 内部错误（500）。 */
public class AdminInternalException extends RuntimeException {
    private final String errorCode;
    public AdminInternalException(final String errorCode, final String message) {
        super(message);
        this.errorCode = errorCode;
    }
    public String getErrorCode() { return errorCode; }
}
