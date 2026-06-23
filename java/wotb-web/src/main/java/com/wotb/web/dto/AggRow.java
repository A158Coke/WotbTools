package com.wotb.web.dto;

import java.util.Map;

/** 汇总表一行(用 Map 承载单元格 + 该选手最近一场队伍, 供 UI 行底色)。 */
public record AggRow(Map<String, Object> cells, int team) {
}
