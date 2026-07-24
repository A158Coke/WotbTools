package com.wotb.core.processing;

import java.util.Objects;

/**
 * 战斗身份标识，用于同一场战斗的识别。
 * 优先使用 arenaUniqueId，降级组合其它稳定字段。
 */
public record BattleIdentity(
        String arenaUniqueId,
        String mapName,
        String clientVersion,
        Long battleStartEpochSecond
) {

    public boolean sameBattle(BattleIdentity other) {
        if (this == other) return true;
        if (other == null) return false;
        if (arenaUniqueId != null && other.arenaUniqueId != null) {
            return arenaUniqueId.equals(other.arenaUniqueId);
        }
        // 降级比较
        return Objects.equals(mapName, other.mapName)
                && Objects.equals(clientVersion, other.clientVersion)
                && Objects.equals(battleStartEpochSecond, other.battleStartEpochSecond);
    }
}
