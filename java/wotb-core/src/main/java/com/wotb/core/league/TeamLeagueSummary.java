package com.wotb.core.league;

import java.util.List;

/**
 * 批次战队汇总。
 *
 * <p>批次 team key：优先多数军团标签（跨场合并同一战队）；无法确定跨场身份时
 * 使用 {@code arenaId:team} 保持为不同的比赛内战队行（禁止把所有 Team 1 合并成一个战队）。</p>
 */
public record TeamLeagueSummary(
        // 批次 team key（clan 标签或 arenaId:team）
        String teamKey,
        // 自动名称（多数军团标签）；null = 待命名
        String autoName,
        // CLAN_MAJORITY / UNNAMED
        String nameSource,
        int battles,
        // 单场 teamRating 中位数（未取整）
        double ratingMedian,
        // 八个团队维度分各自的中位数
        List<Double> dimensionMedians,
        int wins,
        // 组成该 key 的 {arenaId}:{team} 实例列表（前端名称覆盖绑定用）
        List<String> arenaTeams) {
}
