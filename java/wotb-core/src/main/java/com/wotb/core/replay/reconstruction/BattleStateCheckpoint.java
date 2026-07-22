package com.wotb.core.replay.reconstruction;

/**
 * 战场状态检查点：存储某个时刻的状态快照和对应的事件序号。
 * <p>
 * 用于支持快速任意时刻状态查询：
 * 查询时找到时间点之前最近 checkpoint，复制 checkpoint，
 * 然后继续应用 checkpoint 后、目标时间前的事件。
 * </p>
 *
 * @param rawClockSec  检查点对应的原始时钟
 * @param eventIndex   检查点对应的事件序号（事件列表中的索引）
 * @param stateSnapshot 该时刻的战场状态快照
 */
public record BattleStateCheckpoint(
        float rawClockSec,
        int eventIndex,
        BattleStateSnapshot stateSnapshot
) {
}
