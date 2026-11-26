package com.wotb.core.replay.event;

public record RawAssaultBaseUpdate(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        Integer rawField1,
        Integer rawField2,
        Integer rawField3,
        Integer rawField4
) implements ReplayEvent {
}
