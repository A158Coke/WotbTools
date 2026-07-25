package com.wotb.core.processing;

/** 单文件处理错误。 */
public record ReplayProcessingError(
        String code,
        String message
) {

    public static ReplayProcessingError of(Exception e) {
        final String msg = e.getMessage();
        return new ReplayProcessingError(
                "PROCESSING_ERROR",
                msg != null ? msg : e.getClass().getSimpleName());
    }

    public static ReplayProcessingError of(String code, String message) {
        return new ReplayProcessingError(code, message);
    }
}
