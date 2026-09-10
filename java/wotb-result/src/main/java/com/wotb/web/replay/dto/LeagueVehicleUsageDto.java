package com.wotb.web.replay.dto;

/**
 * 选手「最常使用坦克」（当前批次 rated-only 样本）。
 *
 * <p>API 只回 key + 数据（tankId/tankName/battles），显示 Label 与百分比由前端计算；
 * 无可靠车辆数据时为 null（不伪造坦克）。</p>
 *
 * @param tankId   坦克 ID
 * @param tankName 由 Tankopedia 提供的官方名称
 * @param battles  该坦克的使用场次（仅 rated-only 样本）
 */
public record LeagueVehicleUsageDto(long tankId, String tankName, int battles) {
}
