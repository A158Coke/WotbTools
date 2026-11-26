package com.wotb.core.replay.event;

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

    public static boolean isPlausibleHp(final Integer hp) {
        return hp != null && hp > 0 && hp < 0xFF00;
    }
}
