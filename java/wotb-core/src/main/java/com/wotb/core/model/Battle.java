package com.wotb.core.model;

import org.springframework.util.StringUtils;

import java.util.List;

public class Battle {
    public String arenaId;
    public Integer winnerTeam;
    public Integer arenaBonusType;
    public String version = "";
    public String mapName = "";
    public Double durationS;
    public Long startTime;

    public Long settlementStartTime;
    public Integer settlementFinishReasonRaw;
    public Double settlementDurationSec;
    public String recorder = "";
    public String recorderVehicle = "";
    public String clientVersion = "";
    public List<PlayerResult> players;

    public Boolean rosterComplete;

    public int nPlayers() {
        return players == null ? 0 : players.size();
    }

    public PlayerResult recorderResult() {
        if (!StringUtils.hasText(recorder) || players == null) {
            return null;
        }
        for (final PlayerResult p : players) {
            if (recorder.equals(p.nickname)) {
                return p;
            }
        }
        return null;
    }
}
