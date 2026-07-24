package com.wotb.core.replay.reconstruction;

/**
 * 战斗生命周期阶段。
 */
public enum BattleLifecycle {
    /** 尚未开始（准备阶段/倒计时） */
    PRE_BATTLE,

    /** 战斗进行中 */
    IN_PROGRESS,

    /** 战斗已结束 */
    FINISHED
}
