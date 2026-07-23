package com.wotb.core.processing;

import java.util.List;

/**
 * 文件级验证结果。
 *
 * @param valid   是否通过验证
 * @param errors  错误列表（valid=false 时）
 */
public record ReplayFileValidationResult(
        boolean valid,
        List<ReplayValidationError> errors
) {

    public static ReplayFileValidationResult ok() {
        return new ReplayFileValidationResult(true, List.of());
    }

    public static ReplayFileValidationResult failed(List<ReplayValidationError> errors) {
        return new ReplayFileValidationResult(false, errors);
    }

    /** 单个验证错误。 */
    public record ReplayValidationError(
            String code,
            String message
    ) {
        public static ReplayValidationError of(String code, String message) {
            return new ReplayValidationError(code, message);
        }
    }
}
