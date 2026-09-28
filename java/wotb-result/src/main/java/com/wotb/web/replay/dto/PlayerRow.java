package com.wotb.web.replay.dto;

import java.util.Map;

/**
 * 单名玩家(用 Map 承载, 键与 Columns 的 key 对齐, 便于前端通用渲染)。
 *
 * <p>{@code accountId}/{@code vehicleId} 是<b>结构性身份</b>，不是展示列（B6：账号 / 车辆 ID
 * 不再占用公共列），供前端行选中、排序 tie-break、跨场 join 与车辆详情使用。</p>
 */
public record PlayerRow(Map<String, Object> cells, int team, long accountId, long vehicleId) {
}
