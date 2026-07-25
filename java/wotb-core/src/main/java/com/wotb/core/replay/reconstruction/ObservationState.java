package com.wotb.core.replay.reconstruction;

/**
 * 实体的数据可观测状态。
 * 不要使用简单 boolean visible 表达四种不同状态。
 */
public enum ObservationState {
    /** 状态未知（尚未收到该实体的任何数据） */
    UNKNOWN,

    /** 当前有数据更新，可观测 */
    OBSERVED,

    /** 数据已过期（一段时间未更新） */
    STALE,

    /** 实体已被移除 */
    REMOVED
}
