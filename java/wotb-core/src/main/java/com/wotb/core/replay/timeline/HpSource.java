package com.wotb.core.replay.timeline;

/**
 * 血量值来源/权威性。
 */
public enum HpSource {
    /**
     * 回放事件流精确观测（type-7 propId=3，EXACT；含阵亡 0 与死亡 sentinel 归一化）
     */
    EXACT_BATTLE_EVENT,
    /**
     * 由战斗数据观测推导（如 ObservedMaxHp）
     */
    OBSERVED_BATTLE_DATA,
    /**
     * tankopedia 参考基线（reference data，不是本场实际值）
     */
    BASE_REFERENCE,
    /**
     * 推断值
     */
    INFERRED,
    /**
     * 未知
     */
    UNKNOWN
}
