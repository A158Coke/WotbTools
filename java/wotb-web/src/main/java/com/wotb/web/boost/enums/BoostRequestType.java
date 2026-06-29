package com.wotb.web.boost.enums;

/** 陪练需求类型。 */
public enum BoostRequestType {
    COACHING("技术指导 / 意识陪练"),
    RATING_IMPROVEMENT("胜率 / 评分提升"),
    MISSION("任务协助"),
    TANK_GRIND("车辆研发"),
    RANKED("排位协助"),
    TOURNAMENT_TRAINING("比赛训练"),
    OTHER("其他");

    private final String label;

    BoostRequestType(final String label) {
        this.label = label;
    }

    public String label() {
        return label;
    }

    public static BoostRequestType from(final String value) {
        for (final BoostRequestType t : values()) {
            if (t.name().equalsIgnoreCase(value)) {
                return t;
            }
        }
        throw new IllegalArgumentException("未知需求类型: " + value);
    }
}
