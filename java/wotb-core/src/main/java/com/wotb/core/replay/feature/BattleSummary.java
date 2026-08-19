package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;

/** 战后统计摘要。 */
public record BattleSummary(
        String mapName,
        int durationSec,
        Integer winnerTeam,
        int playerCount
) {
    public static BattleSummary from(com.wotb.core.model.Battle battle) {
        return new BattleSummary(
                battle.mapName,
                battle.durationS != null ? battle.durationS.intValue() : 0,
                battle.winnerTeam,
                battle.nPlayers()
        );
    }
}
