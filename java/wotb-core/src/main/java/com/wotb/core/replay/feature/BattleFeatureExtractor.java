package com.wotb.core.replay.feature;

import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

/**
 * 战斗特征提取器接口（占位，后续实现具体战术特征）。
 *
 * TODO: implement concrete feature extraction logic in next phase (AI integration)
 * - Opening route analysis
 * - Engagement detection
 * - Damage exchange patterns
 * - Movement heatmap
 * - Survival analysis
 */
public interface BattleFeatureExtractor {

    /**
     * 从重建结果中提取特征。
     *
     * @param reconstruction 完整重建结果
     * @param finalState     最终战场状态
     * @return 特征集
     */
    BattleFeatureSet extract(ReplayReconstruction reconstruction, BattleStateSnapshot finalState);
}
