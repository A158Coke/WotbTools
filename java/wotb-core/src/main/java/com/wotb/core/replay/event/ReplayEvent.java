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
                AttachedTransformEvent,
                HealthChangedEvent,
                DamageEvent,
                EntityCreatedEvent,
                MaterializationAnnouncedEvent,
                MaterializationEvent,
                EntityRemovedEvent,
                VehicleDestroyedEvent,
                UnknownReplayEvent,
                ParticipantMappingEvent,
                TurretDirectionChangedEvent,
                SupremacyPointsChangedEvent,
                RecorderHealthChangedEvent,
                VehicleHealthStateEvent,
                VehicleModuleCrewStateEvent,
                VehicleFiredEvent,
                ProjectileLaunchedEvent,
                ProjectileTerminalEvent,
                ProjectileResolutionEvent,
                ShotResultEvent,
                TargetingInfoSnapshotEvent,
                GunMarkerSizeEvent,
                AimRayStateEvent,
                AmmunitionSelectionChangedEvent,
                AmmunitionStateEvent,
                UnsupportedDamageEvent,
                SessionDecisecondLowByteEvent,
                ArenaPeriodChangedEvent,
                RoundFinishedEvent,
                ReplayStreamClosedEvent,
                VehicleHitEvent,
                VehicleVehicleCollisionEvent {

    int sequence();
    ReplayTimestamp timestamp();
    int packetType();
    DecodeConfidence confidence();
}
