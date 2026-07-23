package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;

/**
 * 战斗阶段摘要。
 */
public record BattlePhaseSummary(
        float startTime,
        float endTime,
        BattlePhaseType type,
        DecodeConfidence confidence
) {
}
