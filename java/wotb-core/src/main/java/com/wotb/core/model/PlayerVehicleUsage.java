package com.wotb.core.model;

/**
 * 一名选手对某辆车的使用统计（tankId + 使用场次）。
 *
 * <p>Core 只承载 tankId 与场次数，不复制 Tankopedia 数据；车辆名称解析（如「最常使用坦克」
 * 按官方名忽略大小写升序 → tankId 升序选择）由展示层消费 Tankopedia 单一事实源完成。
 * Replay 跨场 Aggregate 与 League 批次汇总共用本 record（B6：不新建第二份类型）。</p>
 *
 * @param tankId  坦克 ID
 * @param battles 该车辆的使用场次
 */
public record PlayerVehicleUsage(long tankId, int battles) {
}