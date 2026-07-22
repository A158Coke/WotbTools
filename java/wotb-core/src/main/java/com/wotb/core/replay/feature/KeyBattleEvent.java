package com.wotb.core.replay.feature;

/**
 * 关键战斗事件（占位，后续扩展）。
 *
 * TODO: define concrete event types in next phase (e.g. FIRST_ENGAGEMENT, CRITICAL_HIT, POSITION_SHIFT)
 *
 * @param clockSec  事件发生时间
 * @param type      事件类型编码
 * @param label     简要描述
 */
public record KeyBattleEvent(
        float clockSec,
        String type,
        String label
) {
}
