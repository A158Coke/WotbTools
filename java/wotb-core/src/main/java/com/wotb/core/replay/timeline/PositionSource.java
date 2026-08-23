package com.wotb.core.replay.timeline;

/** 位置来源。 */
public enum PositionSource {
    /** 来自位置流事件（type-10）的观测 */
    OBSERVED_EVENT,
    /** 沿用最近一次可靠位置（不插值，仅携带 age） */
    CARRIED_FORWARD,
    /** 未知 */
    UNKNOWN
}
