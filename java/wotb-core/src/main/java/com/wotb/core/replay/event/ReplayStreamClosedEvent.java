package com.wotb.core.replay.event;

public record ReplayStreamClosedEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence
) implements ReplayEvent {
}