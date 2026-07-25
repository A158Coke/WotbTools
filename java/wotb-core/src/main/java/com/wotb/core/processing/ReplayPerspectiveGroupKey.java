package com.wotb.core.processing;

/** 视角分组键：BattleGroupingKey（equals/hashCode）+ perspectiveTeam。 */
public record ReplayPerspectiveGroupKey(
        BattleGroupingKey battleKey,
        int perspectiveTeam
) {
}
