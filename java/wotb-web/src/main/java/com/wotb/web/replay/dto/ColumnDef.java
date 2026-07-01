package com.wotb.web.replay.dto;

/** 列定义 (纯数据形状: 字段键 + 是否数值)。中文显示名由前端/导出层各自映射。 */
public record ColumnDef(String key, boolean num) {
}
