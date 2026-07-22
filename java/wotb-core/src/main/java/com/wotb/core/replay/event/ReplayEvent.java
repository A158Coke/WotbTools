package com.wotb.core.replay.event;

/**
 * 统一的领域事件接口。
 * <p>
 * 所有已知的、部分已知的和未知的事件都必须实现此接口。
 * 一个原始包可以产生零个、一个或多个 ReplayEvent。
 * </p>
 */
public sealed interface ReplayEvent
        permits PositionChangedEvent,
                HealthChangedEvent,
                DamageEvent,
                EntityCreatedEvent,
                EntityRemovedEvent,
                VehicleDestroyedEvent,
                BattleEndedEvent,
                UnknownReplayEvent,
                ParticipantMappingEvent {

    /** 事件在原始流中的稳定顺序 */
    int sequence();

    /** 事件的时间戳（原始时钟 + 战斗时钟） */
    ReplayTimestamp timestamp();

    /** 来源的原始 packet type */
    int packetType();

    /** 解码置信度 */
    DecodeConfidence confidence();
}
