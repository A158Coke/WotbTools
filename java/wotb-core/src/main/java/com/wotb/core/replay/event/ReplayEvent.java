package com.wotb.core.replay.event;

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
                RawSupremacyBaseUpdate,
                SupremacyBaseStateTransition,
                RawAssaultBaseUpdate,
                AssaultBaseStateTransition,
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
                EntityAuxiliaryBlobEvent,
                ConsumableLifecycleEvent,
                ReplayStreamClosedEvent,
                VehicleHitEvent,
                VehicleVehicleCollisionEvent {

    int sequence();
    ReplayTimestamp timestamp();
    int packetType();
    DecodeConfidence confidence();
}
