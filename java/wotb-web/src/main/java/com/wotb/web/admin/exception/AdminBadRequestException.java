package com.wotb.web.admin.exception;

public class AdminBadRequestException extends RuntimeException {
    private final String errorCode;
    public AdminBadRequestException(final String errorCode, final String message) {
        super(message);
        this.errorCode = errorCode;
    }
    public String getErrorCode() { return errorCode; }
}
