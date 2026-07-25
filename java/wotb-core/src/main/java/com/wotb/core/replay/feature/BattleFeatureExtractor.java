package com.wotb.core.replay.feature;

import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

/**
 * 战斗特征提取器接口。
 * 默认实现负责移动、交火、战斗阶段和关键事件等战术特征。
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
