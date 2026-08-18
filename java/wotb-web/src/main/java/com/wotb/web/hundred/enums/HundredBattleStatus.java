package com.wotb.web.hundred.enums;

/**
 * 名人堂「百场」submission 状态（VARCHAR + CHECK，非 PG ENUM）。
 * 语义见 docs/current-plan.md §18：PENDING 等待人工审核；CURRENT 当前公开有效纪录；
 * SUPERSEDED 曾被更高纪录替代（不公开、保留 audit）；REJECTED 人工拒绝；
 * CANCELLED 用户在审核前主动取消；DELETED 管理员删除当前纪录（不公开、保留 audit）。
 */
public enum HundredBattleStatus {

    PENDING,
    CURRENT,
    SUPERSEDED,
    REJECTED,
    CANCELLED,
    DELETED;

    public static HundredBattleStatus from(final String value) {
        if (value == null) {
            throw new IllegalArgumentException("INVALID_HUNDRED_STATUS");
        }
        try {
            return valueOf(value);
        } catch (final IllegalArgumentException e) {
            throw new IllegalArgumentException("INVALID_HUNDRED_STATUS");
        }
    }
}
