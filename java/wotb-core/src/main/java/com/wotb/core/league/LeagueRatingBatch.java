package com.wotb.core.league;

import java.util.List;

/**
 * 一个训练赛/联赛批次的完整 League Rating 结果（仅当前 HTTP 请求内存生命周期）。
 *
 * <p>{@link #battleResults()} 与调用方持有的 battles 列表按下标对齐（只含通过完整性校验
 * 并完成评分的场次）；失败/冲突场次在 {@link #failures()} 中以稳定错误码报告。</p>
 */
public record LeagueRatingBatch(
        List<LeagueRatingResult> battleResults,
        List<PlayerLeagueSummary> playerSummaries,
        List<TeamLeagueSummary> teamSummaries,
        List<LeagueFailure> failures) {

    public LeagueRatingBatch {
        battleResults = battleResults == null ? List.of() : List.copyOf(battleResults);
        playerSummaries = playerSummaries == null ? List.of() : List.copyOf(playerSummaries);
        teamSummaries = teamSummaries == null ? List.of() : List.copyOf(teamSummaries);
        failures = failures == null ? List.of() : List.copyOf(failures);
    }
}
