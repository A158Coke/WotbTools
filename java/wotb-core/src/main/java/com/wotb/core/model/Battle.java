package com.wotb.core.model;

import org.springframework.util.StringUtils;

import java.util.List;

/** 一场战斗的基本信息 + 全部玩家战绩。 */
public class Battle {
    public String arenaId;
    public Integer winnerTeam;
    /** 模式类型 (meta.json#arenaBonusType): 1=随机战斗; 2=训练房; 其他=娱乐/联赛等; null=未知。 */
    public Integer arenaBonusType;
    public String version = "";
    public String mapName = "";
    public Double durationS;
    public Long startTime;
    public String recorder = "";
    public String recorderVehicle = "";
    public String clientVersion = "";
    public List<PlayerResult> players;

    public int nPlayers() {
        return players == null ? 0 : players.size();
    }

    /**
     * 录像者本人的战绩。meta 无录像者 accountId, 故按 {@link #recorder} 昵称在 {@link #players} 中匹配。
     * 无录像者名 / 无名册 / 匹配不到时返回 null。
     */
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
