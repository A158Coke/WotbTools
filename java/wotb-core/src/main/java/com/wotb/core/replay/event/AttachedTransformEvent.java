package com.wotb.core.replay.event;

public record AttachedTransformEvent(
        int sequence,
        ReplayTimestamp timestamp,
        int packetType,
        DecodeConfidence confidence,
        int entityId,
        int spaceId,
        int attachmentParentEntityId,
        float localX,
        float localY,
        float localZ,
        float positionErrorX,
        float positionErrorY,
        float positionErrorZ,
        float yaw,
        float pitch,
        float roll,
        int trailingStateRaw
) implements ReplayEvent {
}
