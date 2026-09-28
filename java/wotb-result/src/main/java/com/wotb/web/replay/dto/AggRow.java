package com.wotb.web.replay.dto;

import java.util.Map;

/**
 * 汇总表一行(用 Map 承载单元格 + 该选手最近一场队伍, 供 UI 行底色)。
 *
 * <p>{@code accountId} 是<b>结构性身份</b>，不是展示列（B6：账号 ID 不再占用公共列），
 * 供前端排序 tie-break、Radar reference 匹配与 League summary join 使用。</p>
 */
public record AggRow(Map<String, Object> cells, int team, long accountId) {
}
