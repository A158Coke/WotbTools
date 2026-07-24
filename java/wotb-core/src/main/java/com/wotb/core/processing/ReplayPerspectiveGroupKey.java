package com.wotb.core.processing;

/**
 * 视角分组键：BattleGroupingKey（负责 equals/hashCode）+ perspectiveTeam。
 * <p>
 * BattleIdentity 仅用于 API 输出和显示，不参与 equals/hashCode。
 * </p>
 */
public record ReplayPerspectiveGroupKey(
        BattleGroupingKey battleKey,
        BattleIdentity battleIdentity,
        int perspectiveTeam
) {
}
