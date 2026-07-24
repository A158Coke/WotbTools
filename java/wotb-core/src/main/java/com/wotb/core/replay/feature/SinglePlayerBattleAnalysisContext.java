package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.processing.BattleIdentity;
import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayCoverage;

import java.util.List;

/**
 * 单场随机战斗 AI 分析上下文。
 * 必须包含权威结算数据 Battle，不可只依赖重建特征。
 */
public record SinglePlayerBattleAnalysisContext(
        BattleIdentity battleId,
        Battle battle,
        PlayerBattleFeatureSet features,
        RecorderEntityMapping recorder,
        ReplayCoverage coverage,
        List<String> limitations
) {
}
