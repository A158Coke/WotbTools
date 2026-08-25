package com.wotb.core.league;

import java.util.List;

/** 一场训练赛/联赛回放的完整 League Rating 结果。 */
public record LeagueRatingResult(
        // 稳定 identity：本场 arenaId（与 Battle 关联不依赖数组 index）
        String arenaId,
        // 14 名玩家各自评分
        List<PlayerLeagueRating> players,
        // Team 1 / Team 2 战队评分
        TeamLeagueRating team1,
        TeamLeagueRating team2,
        // 全场 MVP（finalRating 最高，排序规则见计算器）
        PlayerLeagueRating mvp,
        // 本场是否全部校验通过并完成评分
        boolean rated) {

    /** 按 accountId 查玩家评分（重复 accountId 已被校验拒绝，安全）。 */
    public PlayerLeagueRating byAccount(final long accountId) {
        for (final PlayerLeagueRating p : players) {
            if (p.accountId() == accountId) {
                return p;
            }
        }
        return null;
    }

    /** 某队评分。 */
    public TeamLeagueRating team(final int team) {
        return team == 1 ? team1 : team2;
    }
}
