package com.wotb.core.replay.event;

/**
 * 实体血量变化事件（对应 Packet Type 7 EntityProperty 的血量相关属性）。
 *
 * @param sequence       事件顺序号
 * @param timestamp      时间戳
 * @param packetType     来源原始 packet type
 * @param confidence     解码置信度
 * @param entityId       实体 ID
 * @param currentHealth  当前血量；null 表示未知
 * @param maxHealth      最大血量；null 表示未知
 * @param alive          存活状态；true=存活, false=阵亡, null=未知
 */
public record HealthChangedEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int entityId,
        Integer currentHealth,
        Integer maxHealth,
        Boolean alive
) implements ReplayEvent {

    /** 已证明的 HP 未知 sentinel（原始 u16=0xFFFD，与争霸击毁 ±40 点事件重合；绝非 65533 HP）。 */
    public static final int SENTINEL_UNKNOWN_HP = 0xFFFD;

    /**
     * 保守归一化：可信正 HP 必须 >0 且 < 0xFF00。任何 ≥0xFF00 的 u16 高位值（含 0xFFFD）
     * 都视为不可信 sentinel/损坏——不臆测其具体语义，但绝不作为真实血量进入任何计算。
     */
    public static boolean isPlausibleHp(final Integer hp) {
        return hp != null && hp > 0 && hp < 0xFF00;
    }
}
