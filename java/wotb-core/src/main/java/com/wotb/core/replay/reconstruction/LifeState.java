package com.wotb.core.replay.reconstruction;

/**
 * 车辆的存活状态。
 */
public enum LifeState {
    /** 存活状态未知（尚未接收到任何血量或状态事件） */
    UNKNOWN,

    /** 确认存活 */
    ALIVE,

    /** 确认被击毁 */
    DESTROYED
}
