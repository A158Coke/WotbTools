package com.wotb.web.replay.dto;

import java.util.List;

/**
 * /api/preview 的响应: 各场 + 汇总 + 去重/失败提示 + 列定义。
 * 单场玩家表已直接包含 Contribution / KAST / Impact（同一 PerformanceMetricsCalculator
 * 公式、同一 authoritative Battle/PlayerResult facts）；汇总表包含跨场 Contribution /
 * KAST / Impact / 多伤率 / 互换击杀。不再有独立「战斗表现」模块/字段。
 *
 * <p>League Rating 模式（训练赛/联赛回放）：{@code league} 携带 Rating 元数据与汇总；
 * 普通模式 {@code league=null}（契约兼容）。League 模式下 playerColumns/aggregateColumns
 * 由服务端调整为不含 contribution/kast/impact、包含 Rating 维度列。</p>
 */
public record PreviewResponse(List<BattleDto> battles,
                              List<AggRow> aggregate,
                              List<String[]> duplicates,
                              List<String[]> failures,
                              List<ColumnDef> playerColumns,
                              List<ColumnDef> aggregateColumns,
                              LeagueRatingDto league) {
}
