package com.wotb.core.replay.event;

public record RawSupremacyBaseUpdate(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        Integer baseIndex,
        Integer ownerTeam,
        Integer capturingTeam,
        Integer captureProgress,
        Integer rawField5,
        Integer rawField6
) implements ReplayEvent {
}
