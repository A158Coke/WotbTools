package com.wotb.core.model;

import java.util.List;

/** 一场战斗的基本信息 + 全部玩家战绩。 */
public class Battle {
    public String arenaId;
    public Integer winnerTeam;
    public String version = "";
    public String mapName = "";
    public Double durationS;
    public Long startTime;
    public String recorder = "";
    public String recorderVehicle = "";
    public List<PlayerResult> players;

    public int nPlayers() {
        return players == null ? 0 : players.size();
    }
}
