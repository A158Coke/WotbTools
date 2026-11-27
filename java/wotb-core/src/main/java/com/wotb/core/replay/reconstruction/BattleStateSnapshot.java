package com.wotb.core.replay.reconstruction;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public record BattleStateSnapshot(
        float rawClockSec,
        Float battleClockSec,
        BattleLifecycle lifecycle,
        Map<Integer, VehicleState> vehiclesByEntityId,
        Map<Long, Integer> entityIdByAccountId,
        List<BattleParticipant> participants,
        boolean battleEnded,
        Integer winnerTeam
) {

    public VehicleState vehicleByEntityId(int entityId) {
        return vehiclesByEntityId.get(entityId);
    }

    public Integer entityIdByAccountId(long accountId) {
        return entityIdByAccountId.get(accountId);
    }

    public int entityCount() {
        return vehiclesByEntityId.size();
    }

    public int participantCount() {
        return participants.size();
    }

    public static BattleStateSnapshot empty() {
        return new BattleStateSnapshot(
                0f, null, BattleLifecycle.PRE_BATTLE,
                Collections.emptyMap(), Collections.emptyMap(),
                List.of(), false, null);
    }

    static BattleStateSnapshot from(BattleState state) {
        final Map<Integer, VehicleState> vehicleCopies = new HashMap<>();
        for (final Map.Entry<Integer, VehicleState> entry : state.getVehiclesByEntityId().entrySet()) {
            vehicleCopies.put(entry.getKey(), entry.getValue().copy());
        }
        return new BattleStateSnapshot(
                state.getRawClockSec(),
                state.getBattleClockSec(),
                state.getLifecycle(),
                Collections.unmodifiableMap(vehicleCopies),
                Collections.unmodifiableMap(new HashMap<>(state.getEntityIdByAccountId())),
                List.copyOf(state.getParticipants()),
                state.isBattleEnded(),
                state.getWinnerTeam()
        );
    }

    @Override
    public String toString() {
        return "BattleStateSnapshot{"
                + "rawClockSec=" + rawClockSec
                + ", lifecycle=" + lifecycle
                + ", vehicles=" + vehiclesByEntityId.size()
                + ", participants=" + participants.size()
                + ", battleEnded=" + battleEnded
                + '}';
    }
}
