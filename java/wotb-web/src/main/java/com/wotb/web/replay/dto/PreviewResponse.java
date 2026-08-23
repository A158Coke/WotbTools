package com.wotb.web.replay.dto;

import java.util.List;

/**
 * /api/preview 的响应: 各场 + 汇总 + 战斗表现 + 去重/失败提示 + 列定义。
 * 战斗表现与基础战绩/汇总由<b>同一次回放处理</b>产出（同一 authoritative Battle/PlayerResult facts）。
 */
public record PreviewResponse(List<BattleDto> battles,
                              List<AggRow> aggregate,
                              List<PerformanceRow> performance,
                              List<String[]> duplicates,
                              List<String[]> failures,
                              List<ColumnDef> playerColumns,
                              List<ColumnDef> aggregateColumns,
                              List<ColumnDef> performanceColumns) {
}
