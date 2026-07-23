package com.wotb.core.processing;

/**
 * 视角分组键：同一场战斗 + 同一队伍构成唯一的队伍视角。
 */
public record ReplayPerspectiveGroupKey(
        BattleIdentity battleIdentity,
        int perspectiveTeam
) {

    public static ReplayPerspectiveGroupKey of(BattleIdentity battleId, int team) {
        return new ReplayPerspectiveGroupKey(battleId, team);
    }
}
