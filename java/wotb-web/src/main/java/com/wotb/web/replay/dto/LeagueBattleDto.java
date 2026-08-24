package com.wotb.web.replay.dto;

/** 单场 League Rating 元数据（嵌入 BattleDto；普通模式为 null）。 */
public record LeagueBattleDto(
        String mvpNickname,
        long mvpAccountId,
        String team1BestNickname,
        long team1BestAccountId,
        String team2BestNickname,
        long team2BestAccountId,
        LeagueTeamDto team1,
        LeagueTeamDto team2) {
}
