package com.wotb.core.replay.processing;

/** 视角分组键：BattleGroupingKey（equals/hashCode）+ perspectiveTeam。 */
public record ReplayPerspectiveGroupKey(
        BattleGroupingKey battleKey,
        int perspectiveTeam
) {
}
