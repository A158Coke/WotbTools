package com.wotb.web.battledata.dto;

import java.util.List;

/** 已通过严格读取边界验证的 v1 观测，不包含玩家身份。 */
public record BattleDataRequest(int schemaVersion, String arenaId, int arenaBonusType,
        int mapId, String mapKey, String clientVersion, int winnerTeam, List<Team> teams) {
    public BattleDataRequest {
        teams = List.copyOf(teams);
    }

    public record Team(int team, String spawn, List<Integer> vehicles) {
        public Team {
            vehicles = List.copyOf(vehicles);
        }
    }
}
