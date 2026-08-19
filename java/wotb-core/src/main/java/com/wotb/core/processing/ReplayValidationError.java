package com.wotb.core.processing;

/** 文件级验证错误。 */
public record ReplayValidationError(
        String code,
        String message
) {
    public static ReplayValidationError of(String code, String message) {
        return new ReplayValidationError(code, message);
    }
}
