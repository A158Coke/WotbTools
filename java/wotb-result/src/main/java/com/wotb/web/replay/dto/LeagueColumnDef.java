package com.wotb.web.replay.dto;

/** League Rating 列定义（key + 是否数值 + 维度满分 + 固定/默认可见/分组元数据）。 */
public record LeagueColumnDef(String key, boolean num, double max,
                              boolean fixed, boolean defaultVisible, String group) {
}
