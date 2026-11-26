package com.wotb.core.replay.processing;

import java.util.Objects;

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
        return Objects.equals(mapName, other.mapName)
                && Objects.equals(clientVersion, other.clientVersion)
                && Objects.equals(battleStartEpochSecond, other.battleStartEpochSecond);
    }
}
