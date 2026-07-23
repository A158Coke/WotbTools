package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.processing.ReplayProcessingResult;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

/**
 * 单场 AI 分析上下文（预留模型，后续实现 AiInputFactory 时使用）。
 *
 * TODO: implement SingleBattleAiInputFactory to construct this from ReplayProcessingResult
 */
public record SingleBattleAnalysisContext(
        ReplayProcessingResult replay,
        BattleSummary battleSummary,
        ReplayReconstruction reconstruction,
        BattleFeatureSet features,
        Coverage coverage
) {
}
