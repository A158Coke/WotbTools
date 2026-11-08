package com.wotb.web.aireviewfeedback.dto;

/** AI 复盘反馈处理状态；数据库列 status 为唯一持久化 owner。 */
public enum FeedbackStatus {
    PENDING,
    FIXED;

    public static FeedbackStatus from(final String value) {
        if (value == null) {
            throw new IllegalArgumentException("INVALID_FEEDBACK_STATUS");
        }
        try {
            return valueOf(value);
        } catch (final IllegalArgumentException ex) {
            throw new IllegalArgumentException("INVALID_FEEDBACK_STATUS");
        }
    }
}
