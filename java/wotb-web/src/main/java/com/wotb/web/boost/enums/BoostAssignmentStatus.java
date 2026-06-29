package com.wotb.web.boost.enums;

/** 分配记录状态。 */
public enum BoostAssignmentStatus {
    ASSIGNED("已分配"),
    ACCEPTED("已接受"),
    DECLINED("已拒绝"),
    CANCELLED("已取消"),
    COMPLETED("已完成");

    private final String label;

    BoostAssignmentStatus(final String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }

    public static BoostAssignmentStatus from(final String value) {
        for (final BoostAssignmentStatus s : values()) {
            if (s.name().equalsIgnoreCase(value)) {
                return s;
            }
        }
        throw new IllegalArgumentException("未知分配状态: " + value);
    }
}
