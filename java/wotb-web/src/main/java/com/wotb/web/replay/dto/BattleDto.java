package com.wotb.web.replay.dto;

import java.util.List;

/** 一场战斗(基本信息 + 玩家行 + League Rating 元数据；普通模式 league=null)。 */
public record BattleDto(String arenaId, String mapName, String version,
                        Double durationS, Long startTime, Integer winnerTeam,
                        String sourceName, List<PlayerRow> players,
                        LeagueBattleDto league) {
}
