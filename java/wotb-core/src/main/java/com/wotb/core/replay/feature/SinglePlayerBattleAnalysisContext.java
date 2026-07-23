package com.wotb.core.replay.feature;

import com.wotb.core.processing.BattleIdentity;
import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayCoverage;

import java.util.List;

/**
 * 单场随机战斗 AI 分析上下文。
 */
public record SinglePlayerBattleAnalysisContext(
        BattleIdentity battleId,
        PlayerBattleFeatureSet features,
        RecorderEntityMapping recorder,
        ReplayCoverage coverage,
        List<String> limitations
) {
}
