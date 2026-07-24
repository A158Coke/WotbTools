package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.PositionChangedEvent;

import java.util.List;

/**
 * 单场战斗特征集 —— AI 战术复盘的核心输入。
 * <p>
 * 包含移动段压缩、交火段、战斗阶段划分、关键事件和完整原始位置流（供进一步分析）。
 * </p>
 *
 * @param battleId    战场/回放标识
 * @param keyEvents   关键事件时间线
 * @param hasFeatures 是否包含有效特征
 * @param positions   完整位置事件流（供追溯分析）
 * @param movements   压缩后的移动段
 * @param engagements 交火段摘要
 * @param phases      战斗阶段划分
 */
public record BattleFeatureSet(
        String battleId,
        List<KeyBattleEvent> keyEvents,
        boolean hasFeatures,
        List<PositionChangedEvent> positions,
        List<MovementSegment> movements,
        List<EngagementSummary> engagements,
        List<BattlePhaseSummary> phases
) {

    public static BattleFeatureSet empty(String battleId) {
        return new BattleFeatureSet(battleId, List.of(), false,
                List.of(), List.of(), List.of(), List.of());
    }
}
