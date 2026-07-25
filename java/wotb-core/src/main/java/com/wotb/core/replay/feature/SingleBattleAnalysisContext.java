package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

/**
 * 单场玩家视角 AI 分析上下文模型。
 * 当前玩家分析路径直接构建兼容提示；该模型保留给后续统一输入工厂。
 */
public record SingleBattleAnalysisContext(
        ReplayProcessingResult replay,
        BattleSummary battleSummary,
        ReplayReconstruction reconstruction,
        BattleFeatureSet features,
        Coverage coverage
) {
}
