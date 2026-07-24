package com.wotb.web.replay.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.wotb.core.replay.reconstruction.BattleLifecycle;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.VehicleState;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * stateAt 查询的响应。
 */
public record StateAtResponse(
        @JsonProperty("rawClockSec") float rawClockSec,
        @JsonProperty("battleClockSec") Float battleClockSec,
        @JsonProperty("lifecycle") BattleLifecycle lifecycle,
        @JsonProperty("vehicles") List<VehicleSnapshot> vehicles,
        @JsonProperty("eventCount") int eventCount
) {

    public static StateAtResponse from(BattleStateSnapshot snapshot) {
        final List<VehicleSnapshot> vehicles = new ArrayList<>();
        for (final Map.Entry<Integer, VehicleState> entry
                : snapshot.vehiclesByEntityId().entrySet()) {
            vehicles.add(VehicleSnapshot.from(entry.getValue()));
        }

        return new StateAtResponse(
                snapshot.rawClockSec(),
                snapshot.battleClockSec(),
                snapshot.lifecycle(),
                vehicles,
                snapshot.entityCount()
        );
    }

    public record VehicleSnapshot(
            @JsonProperty("entityId") int entityId,
            @JsonProperty("accountId") Long accountId,
            @JsonProperty("team") Integer team,
            @JsonProperty("position") float[] position,
            @JsonProperty("currentHealth") Integer currentHealth,
            @JsonProperty("maxHealth") Integer maxHealth,
            @JsonProperty("lifeState") String lifeState,
            @JsonProperty("observationState") String observationState,
            @JsonProperty("damageDealt") int damageDealt,
            @JsonProperty("damageReceived") int damageReceived,
            @JsonProperty("destroyedAt") Float destroyedAt
    ) {
        static VehicleSnapshot from(VehicleState vs) {
            return new VehicleSnapshot(
                    vs.entityId(),
                    vs.accountId(),
                    vs.team(),
                    vs.position() != null
                            ? new float[]{vs.position().x(), vs.position().y(), vs.position().z()}
                            : null,
                    vs.currentHealth(),
                    vs.maxHealth(),
                    vs.lifeState().name(),
                    vs.observationState().name(),
                    vs.damageDealt(),
                    vs.damageReceived(),
                    vs.destroyedAt()
            );
        }
    }
}
