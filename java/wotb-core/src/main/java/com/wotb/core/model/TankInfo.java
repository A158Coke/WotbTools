package com.wotb.core.model;

/** 单辆车的信息 (tank_id -> 名称/等级/车种/国家)。 */
public final class TankInfo {
    public final String name;
    public final Object tier;
    public final String type;   // 车种(轻坦/中坦/重坦/TD)
    public final String nation;

    public TankInfo(String name, Object tier, String type, String nation) {
        this.name = name;
        this.tier = tier;
        this.type = type;
        this.nation = nation;
    }
}
