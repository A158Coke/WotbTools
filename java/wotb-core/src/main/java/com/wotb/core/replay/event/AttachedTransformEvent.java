package com.wotb.core.replay.event;

/**
 * Type10 attached/local transform。PR147 已证明 {@code attachmentParentEntityId != 0}
 * 时 position 是 attached/local transform，不能直接当 world coordinate 使用。
 *
 * <p>因此它与 {@link PositionChangedEvent} 分离：现有地图/移动 consumer 只消费 world
 * PositionChangedEvent，除非未来有经过证明的 parent composition 才能把本事件派生为 world transform。</p>
 */
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
