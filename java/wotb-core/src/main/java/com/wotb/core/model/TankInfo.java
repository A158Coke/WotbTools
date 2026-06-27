package com.wotb.core.model;

/**
 * 单辆车的信息 (tank_id -> 名称/等级/车种/国家)。
 *
 * @param type 车种(轻坦/中坦/重坦/TD)
 */
public record TankInfo(String name, Object tier, String type, String nation, Integer alphaDamage) {
}
