package com.wotb.core.replay.event;

/**
 * Wire-level wrapper12/root11 update. Null means the protobuf field was absent;
 * an explicit protobuf default such as zero remains the integer value zero.
 * Fields 5 and 6 are retained only as raw diagnostics and have no semantics.
 */
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
