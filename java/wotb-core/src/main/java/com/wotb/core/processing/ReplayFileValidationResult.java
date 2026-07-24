package com.wotb.core.processing;

import java.util.List;

/**
 * 文件级验证结果。
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
}
