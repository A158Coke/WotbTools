package com.wotb.web;

import java.util.List;

/** 前端 JSON 用的精简数据结构 (不暴露原始 protobuf 字段)。 */
public final class Dtos {

    private Dtos() {
    }

    /** 单名玩家(用 Map 承载, 键与 Columns 的 key 对齐, 便于前端通用渲染)。 */
    public record PlayerRow(java.util.Map<String, Object> cells, int team) {
    }

    public record BattleDto(String arenaId, String mapName, String version,
                            Double durationS, Long startTime, Integer winnerTeam,
                            String sourceName, List<PlayerRow> players) {
    }

    public record AggRow(java.util.Map<String, Object> cells, int team) {
    }

    /** 列定义 (纯数据形状: 字段键 + 是否数值)。中文显示名由前端/导出层各自映射。 */
    public record ColumnDef(String key, boolean num) {
    }

    public record PreviewResponse(List<BattleDto> battles,
                                  List<AggRow> aggregate,
                                  List<String[]> duplicates,
                                  List<String[]> failures,
                                  List<ColumnDef> playerColumns,
                                  List<ColumnDef> aggregateColumns) {
    }
}
