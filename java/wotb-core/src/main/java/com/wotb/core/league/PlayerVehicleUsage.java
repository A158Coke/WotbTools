package com.wotb.core.league;

/**
 * 一名选手在当前批次已评分场次中对某辆坦克的使用统计。
 *
 * <p>仅承载 tankId 与场次数（Core 不复制 Tankopedia 数据）；最终「最常使用坦克」的
 * 选择（按 Tankopedia 官方名称忽略大小写升序、tankId 升序）由 Web 层 Mapper 消费
 * 现有 Tankopedia 单一事实源完成。</p>
 *
 * @param tankId  坦克 ID
 * @param battles 该坦克的使用场次（仅 rated-only 样本）
 */
public record PlayerVehicleUsage(long tankId, int battles) {
}
