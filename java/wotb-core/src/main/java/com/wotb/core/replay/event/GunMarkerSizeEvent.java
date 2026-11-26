package com.wotb.core.replay.event;

public record GunMarkerSizeEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        float markerSizeRaw
) implements ReplayEvent {
}
