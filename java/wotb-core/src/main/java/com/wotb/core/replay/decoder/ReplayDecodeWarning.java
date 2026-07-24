package com.wotb.core.replay.decoder;

/**
 * 解码过程中的警告信息。
 *
 * @param code    警告码（英文，稳定，如 "NAN_POSITION", "TRUNCATED_PAYLOAD"）
 * @param message 人类可读的警告描述
 */
public record ReplayDecodeWarning(
        String code,
        String message
) {
}
