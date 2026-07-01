package com.wotb.web.admin.exception;

/** 管理员 API 参数错误（400）。 */
public class AdminBadRequestException extends RuntimeException {
    private final String errorCode;
    public AdminBadRequestException(final String errorCode, final String message) {
        super(message);
        this.errorCode = errorCode;
    }
    public String getErrorCode() { return errorCode; }
}
