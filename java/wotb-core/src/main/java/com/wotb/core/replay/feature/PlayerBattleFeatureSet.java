package com.wotb.core.replay.feature;

import com.wotb.core.replay.facts.ShotFact;
import com.wotb.core.replay.facts.TargetingShotPair;

import java.util.List;

/**
 * 随机战斗录像者个人特征集（所有数据基于 recorder entity 过滤）。
 */
public record PlayerBattleFeatureSet(
        List<MovementSegment> movements,
        List<EngagementSummary> engagements,
        List<BattlePhaseSummary> phases,
        List<KeyBattleEvent> keyEvents,
        List<ShotFact> shots,
        List<TargetingShotPair> targetingPairs,
        List<String> limitations,
        boolean hasFeatures
) {

    /** Legacy 便捷构造（无射击/瞄准事实）：供旧调用方/测试保持编译兼容。 */
    public PlayerBattleFeatureSet(
            final List<MovementSegment> movements,
            final List<EngagementSummary> engagements,
            final List<BattlePhaseSummary> phases,
            final List<KeyBattleEvent> keyEvents,
            final List<String> limitations,
            final boolean hasFeatures
    ) {
        this(movements, engagements, phases, keyEvents,
                List.of(), List.of(), limitations, hasFeatures);
    }

    public static PlayerBattleFeatureSet empty() {
        return new PlayerBattleFeatureSet(List.of(), List.of(), List.of(), List.of(),
                List.of(), List.of(), List.of("Recorder entity not mapped"), false);
    }
}
