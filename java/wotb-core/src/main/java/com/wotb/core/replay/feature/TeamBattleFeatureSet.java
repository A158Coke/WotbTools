package com.wotb.core.replay.feature;

import java.util.List;

/**
 * 训练房/联赛队伍特征集。
 * 分析 perspectiveTeam 所有己方实体的整体战术。
 */
public record TeamBattleFeatureSet(
        int perspectiveTeam,
        List<MovementSegment> teamMovements,
        List<EngagementSummary> engagements,
        List<BattlePhaseSummary> phases,
        List<KeyBattleEvent> keyEvents,
        List<String> limitations,
        boolean hasFeatures
) {

    public static TeamBattleFeatureSet empty(int perspectiveTeam) {
        return new TeamBattleFeatureSet(perspectiveTeam, List.of(), List.of(), List.of(),
                List.of(), List.of("Team perspective features not available"), false);
    }
}
