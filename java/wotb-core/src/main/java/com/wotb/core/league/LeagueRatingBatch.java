package com.wotb.core.league;

import java.util.List;

/**
 * 一个训练赛/联赛批次的完整 League Rating 结果（仅当前 HTTP 请求内存生命周期）。
 *
 * <p>{@link #battleResults()} 只含通过完整性校验并完成评分的场次；失败/冲突场次在
 * {@link #failures()} 中以稳定错误码报告。<b>battleResults 与调用方持有的 parsed battles
 * 不再按下标对齐</b>（parsed battles 可含 Rating-ineligible 场次，数量可大于
 * battleResults）；Battle ↔ Rating 的关联用 {@link LeagueRatingResult#arenaId()} 经
 * {@link #resultFor(String)} 按 identity 查找，禁止按数组 index 绑定。</p>
 */
public record LeagueRatingBatch(
        List<LeagueRatingResult> battleResults,
        List<PlayerLeagueSummary> playerSummaries,
        List<TeamLeagueSummary> teamSummaries,
        List<LeagueFailure> failures,
        // 评分质量元数据（非阻断性 limitation；死亡时间 UNKNOWN 玩家数等）
        LeagueRatingQuality ratingQuality) {

    public LeagueRatingBatch {
        battleResults = battleResults == null ? List.of() : List.copyOf(battleResults);
        playerSummaries = playerSummaries == null ? List.of() : List.copyOf(playerSummaries);
        teamSummaries = teamSummaries == null ? List.of() : List.copyOf(teamSummaries);
        failures = failures == null ? List.of() : List.copyOf(failures);
        ratingQuality = ratingQuality == null ? LeagueRatingQuality.NONE : ratingQuality;
    }

    /** 按 arenaId 查找该场的评分结果（该场未评分/不在批次返回 null；identity 绑定，不依赖 index）。 */
    public LeagueRatingResult resultFor(final String arenaId) {
        if (arenaId == null) {
            return null;
        }
        for (final LeagueRatingResult r : battleResults) {
            if (arenaId.equals(r.arenaId())) {
                return r;
            }
        }
        return null;
    }
}
