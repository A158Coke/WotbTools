package com.wotb.web.dto;

import java.util.Map;

/** 单名玩家(用 Map 承载, 键与 Columns 的 key 对齐, 便于前端通用渲染)。 */
public record PlayerRow(Map<String, Object> cells, int team) {
}
