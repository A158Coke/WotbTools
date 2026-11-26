package com.wotb.core.replay.event;

public record VehicleHitEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int attackerEntityId,
        int victimEntityId,
        int primaryResultRaw,
        int secondaryResultRaw,
        byte[] packedMetadataRaw,
        PenetrationFamily penetrationFamily
) implements ReplayEvent {

    public enum PenetrationFamily {
        PENETRATION,
        OTHER
    }

    public static PenetrationFamily penetrationFamily(final int primary, final int secondary) {
        return (primary == 3 || primary == 4 || (primary == 2 && secondary == 0))
                ? PenetrationFamily.PENETRATION : PenetrationFamily.OTHER;
    }
}
