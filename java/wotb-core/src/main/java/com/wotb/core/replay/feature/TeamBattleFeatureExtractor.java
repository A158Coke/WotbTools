package com.wotb.core.replay.feature;

import com.wotb.core.replay.reconstruction.ReplayReconstruction;

/**
 * 训练房/联赛队伍特征提取器。
 * 分析 perspectiveTeam 所有己方实体的整体战术态势。
 */
public interface TeamBattleFeatureExtractor {

    TeamBattleFeatureSet extract(
            ReplayReconstruction reconstruction,
            int perspectiveTeam
    );
}
