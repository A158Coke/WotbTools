package com.wotb.core.replay.event;

/**
 * 实体血量变化事件（对应 Packet Type7 EntityProperty prop3）。
 *
 * <p>PR147：HP 与 terminal/death 是独立事实。{@code currentHealth} 表达可安全使用的
 * 当前 HP 视图；{@code rawCurrentHealth}/{@code rawState} 保留原始 u16 分类，避免把
 * 0xFFFD/0xFFFE 永久压扁成普通 HP=0。</p>
 */
public record HealthChangedEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int entityId,
        Integer currentHealth,
        Integer maxHealth,
        Boolean alive,
        Integer rawCurrentHealth,
        HpRawState rawState
) implements ReplayEvent {

    /** Backward-compatible constructor for synthetic/tests that do not carry raw prop3 provenance. */
    public HealthChangedEvent(
            final int sequence,
            final ReplayTimestamp timestamp,
            final int packetType,
            final DecodeConfidence confidence,
            final int entityId,
            final Integer currentHealth,
            final Integer maxHealth,
            final Boolean alive) {
        this(sequence, timestamp, packetType, confidence, entityId,
                currentHealth, maxHealth, alive, null, HpRawState.UNKNOWN_OTHER);
    }

    public HealthChangedEvent {
        rawState = rawState == null ? HpRawState.UNKNOWN_OTHER : rawState;
    }

    /** 保守当前 HP：只接受 signed-positive plausible values。 */
    public static boolean isPlausibleHp(final Integer hp) {
        return hp != null && hp > 0 && hp < 0xFF00;
    }
}
