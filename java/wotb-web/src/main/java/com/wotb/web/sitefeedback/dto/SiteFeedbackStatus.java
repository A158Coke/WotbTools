package com.wotb.web.sitefeedback.dto;

/** 站点反馈处理状态；数据库列 status 为唯一持久化 owner。 */
public enum SiteFeedbackStatus {
    PENDING,
    FIXED;

    public static SiteFeedbackStatus from(final String value) {
        if (value == null) {
            throw new IllegalArgumentException("INVALID_SITE_FEEDBACK_STATUS");
        }
        try {
            return valueOf(value);
        } catch (final IllegalArgumentException ex) {
            throw new IllegalArgumentException("INVALID_SITE_FEEDBACK_STATUS");
        }
    }
}
