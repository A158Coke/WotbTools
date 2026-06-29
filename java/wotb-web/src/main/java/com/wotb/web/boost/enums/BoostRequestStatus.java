package com.wotb.web.boost.enums;

/** 陪练需求状态。数据库存英文值，前端展示中文 label。 */
public enum BoostRequestStatus {
    NEW("待审核"),
    REVIEWING("审核中"),
    MATCHED("已匹配"),
    CLOSED("已完成"),
    REJECTED("已拒绝"),
    CANCELLED("已取消");

    private final String label;

    BoostRequestStatus(final String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }

    public static BoostRequestStatus from(final String value) {
        for (final BoostRequestStatus s : values()) {
            if (s.name().equalsIgnoreCase(value)) {
                return s;
            }
        }
        throw new IllegalArgumentException("未知需求状态: " + value);
    }
}
