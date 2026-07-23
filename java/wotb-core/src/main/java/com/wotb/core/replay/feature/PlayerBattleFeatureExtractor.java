package com.wotb.core.replay.feature;

import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

/**
 * 随机战斗录像者个人特征提取器。
 * 只分析 recorder entity 的移动、伤害、接敌等。
 */
public interface PlayerBattleFeatureExtractor {

    PlayerBattleFeatureSet extract(
            ReplayReconstruction reconstruction,
            RecorderEntityMapping recorder
    );
}
