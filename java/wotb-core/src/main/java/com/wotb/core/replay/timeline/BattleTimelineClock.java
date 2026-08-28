package com.wotb.core.replay.timeline;

/**
 * battle-relative 时钟解析来源。
 * <p>IDENTIFIED = 流内/重建明确给出 battle start；ESTIMATED = 由 RoundFinishedEvent（method4/AFTERBATTLE）与
 * battle.durationS 推算（当前生产唯一路径）；UNRESOLVED = 无法可靠建立（Timeline 无效）。</p>
 */
public enum BattleTimelineClock {
    IDENTIFIED,
    ESTIMATED,
    UNRESOLVED
}
