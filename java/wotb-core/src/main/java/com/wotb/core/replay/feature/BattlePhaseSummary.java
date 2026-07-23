package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;

/**
 * 战斗阶段摘要。
 *
 * @param startTime  阶段开始时间
 * @param endTime    阶段结束时间
 * @param type       阶段类型
 * @param confidence 分析置信度
 */
public record BattlePhaseSummary(
        float startTime,
        float endTime,
        BattlePhaseType type,
        DecodeConfidence confidence
) {

    public enum BattlePhaseType {
        PRE_BATTLE,
        OPENING,
        FIRST_CONTACT,
        MID_GAME,
        LATE_GAME,
        ENDGAME,
        POST_BATTLE,
        UNKNOWN
    }
}
