package com.wotb.web.replay.dto;

import java.util.List;

/**
 * Preview 响应的 League Rating 元数据（普通模式为 null）。
 *
 * <p>mode 稳定英文码：{@code LEAGUE_RATING} / {@code STANDARD_REPLAY}；混合批次
 * League Rating 不聚合（{@code league=null}，battles 仍按普通回放语义成功返回，
 * PreviewResponse.leagueUnavailableCode 提示）。</p>
 */
public record LeagueRatingDto(
        String mode,
        // Rating 列元数据（总 Rating 固定、七维度满分、占点字段等）
        List<LeagueColumnDef> columns,
        // 批次选手 V6 pooled 汇总（typed）
        List<LeaguePlayerSummaryDto> playerSummaries,
        // 批次战队 V6 pooled 汇总（typed）
        List<LeagueTeamSummaryDto> teamSummaries,
        // 选手/战队汇总表列定义
        List<ColumnDef> playerSummaryColumns,
        List<ColumnDef> teamSummaryColumns,
        // 校验失败/冲突（fileName + arenaId + 稳定 code）
        List<LeagueFailureDto> failures,
        // Deprecated compatibility slot. Death provenance is not League business state.
        LeagueRatingQualityDto ratingQuality) {
}
