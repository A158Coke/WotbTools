package com.wotb.core.replay.timeline;

/**
 * BattleDelta 的类型（docs/current-plan.md §15）。Delta 表示 Frame(t-1) → Frame(t) 的重要变化；
 * 不要把每一个微小 Position packet 变成 AI delta。
 */
public enum DeltaKind {
    /**
     * 位置显著变化（距离超过阈值）
     */
    POSITION_CHANGE,
    /**
     * 九宫格/语义区域切换
     */
    REGION_CHANGE,
    /**
     * 首次接敌（首个伤害事件）
     */
    FIRST_CONTACT,
    /**
     * 敌方首次进入位置流（已知）
     */
    FIRST_KNOWN,
    /**
     * 敌方位置流中断（转为 last-known）
     */
    ENEMY_LOST,
    /**
     * 敌方重新进入位置流
     */
    ENEMY_REACQUIRED,
    /**
     * 已知 HP 变化（双方都已知时给出 delta）
     */
    HP_CHANGE,
    /**
     * 信息空窗后的 HP 差异（重亮后 bounded retrospective inference）
     */
    HP_GAP_DELTA,
    /**
     * 车辆阵亡（当时已知）
     */
    DESTROYED,
    /**
     * 双方存活人数变化
     */
    ALIVE_COUNT_CHANGE,
    /**
     * 局部敌我已知人数变化
     */
    LOCAL_FORCE_CHANGE,
    /**
     * 争霸赛实时点数变化
     */
    POINTS_CHANGE,
    /**
     * 帧内有交火活动（伤害事件）
     */
    ENGAGEMENT_ACTIVITY,
    /**
     * 支援变化（附近友军数变化）
     */
    SUPPORT_CHANGE
}
