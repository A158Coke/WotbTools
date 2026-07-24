package com.wotb.core.replay.feature;

import java.util.List;

/**
 * 随机战斗录像者个人特征集（所有数据基于 recorder entity 过滤）。
 */
public record PlayerBattleFeatureSet(
        List<MovementSegment> movements,
        List<EngagementSummary> engagements,
        List<BattlePhaseSummary> phases,
        List<KeyBattleEvent> keyEvents,
        List<String> limitations,
        boolean hasFeatures
) {

    public static PlayerBattleFeatureSet empty() {
        return new PlayerBattleFeatureSet(List.of(), List.of(), List.of(), List.of(),
                List.of("Recorder entity not mapped"), false);
    }
}
