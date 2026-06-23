package com.wotb.web.dto;

import java.util.List;

/** /api/preview 的响应: 各场 + 汇总 + 去重/失败提示 + 列定义。 */
public record PreviewResponse(List<BattleDto> battles,
                              List<AggRow> aggregate,
                              List<String[]> duplicates,
                              List<String[]> failures,
                              List<ColumnDef> playerColumns,
                              List<ColumnDef> aggregateColumns) {
}
