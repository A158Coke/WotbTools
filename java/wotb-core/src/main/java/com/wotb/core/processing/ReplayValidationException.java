package com.wotb.core.processing;

/** 回放验证异常。 */
public class ReplayValidationException extends RuntimeException {
    private final String code;
    public ReplayValidationException(String code, String message) {
        super(message);
        this.code = code;
    }
    public String getCode() { return code; }
}
