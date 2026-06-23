package com.wotb.web.dto;

import java.util.List;

/** 一场战斗(基本信息 + 玩家行)。 */
public record BattleDto(String arenaId, String mapName, String version,
                        Double durationS, Long startTime, Integer winnerTeam,
                        String sourceName, List<PlayerRow> players) {
}
