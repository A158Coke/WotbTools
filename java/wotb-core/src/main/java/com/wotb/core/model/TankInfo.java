package com.wotb.core.model;

/**
 * 单辆车的信息 (tank_id -> 名称/等级/车种/国家)。
 *
 * @param type 车种(英文: Light/Medium/Heavy/Tank destroyer)
 */
public record TankInfo(
        String name,
        Object tier,
        String type,
        String nation,
        Integer alphaDamage,
        Integer maxHp,
        String extraInfo
) {
}
