package com.wotb.core.replay.reconstruction;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class BattleState {

    private float rawClockSec;
    private Float battleClockSec;
    private BattleLifecycle lifecycle;

    private final Map<Integer, VehicleState> vehiclesByEntityId;
    private final Map<Long, Integer> entityIdByAccountId;
    private final List<BattleParticipant> participants;

    private boolean battleEnded;
    private Integer winnerTeam;

    public BattleState() {
        this.rawClockSec = 0f;
        this.battleClockSec = null;
        this.lifecycle = BattleLifecycle.PRE_BATTLE;
        this.vehiclesByEntityId = new HashMap<>();
        this.entityIdByAccountId = new HashMap<>();
        this.participants = new ArrayList<>();
        this.battleEnded = false;
        this.winnerTeam = null;
    }


    public float getRawClockSec() { return rawClockSec; }
    public Float getBattleClockSec() { return battleClockSec; }
    public BattleLifecycle getLifecycle() { return lifecycle; }
    public Map<Integer, VehicleState> getVehiclesByEntityId() { return vehiclesByEntityId; }
    public Map<Long, Integer> getEntityIdByAccountId() { return entityIdByAccountId; }
    public List<BattleParticipant> getParticipants() { return participants; }
    public boolean isBattleEnded() { return battleEnded; }
    public Integer getWinnerTeam() { return winnerTeam; }


    public void setRawClockSec(float rawClockSec) { this.rawClockSec = rawClockSec; }
    public void setBattleClockSec(Float battleClockSec) { this.battleClockSec = battleClockSec; }
    public void setLifecycle(BattleLifecycle lifecycle) { this.lifecycle = lifecycle; }
    public void setBattleEnded(boolean battleEnded) { this.battleEnded = battleEnded; }
    public void setWinnerTeam(Integer winnerTeam) { this.winnerTeam = winnerTeam; }


    public VehicleState getOrCreateVehicle(int entityId, float clockSec) {
        return vehiclesByEntityId.computeIfAbsent(entityId, k -> {
            final VehicleState vs = new VehicleState(entityId, clockSec);
            vs.setObservationState(ObservationState.OBSERVED);
            return vs;
        });
    }

    public void registerMapping(int entityId, long accountId) {
        entityIdByAccountId.put(accountId, entityId);
        final VehicleState vs = vehiclesByEntityId.get(entityId);
        if (vs != null) {
            vs.setAccountId(accountId);
        }
    }

    public void addParticipant(BattleParticipant participant) {
        participants.add(participant);
    }

    public Integer getEntityIdByAccountId(long accountId) {
        return entityIdByAccountId.get(accountId);
    }

    public VehicleState getVehicle(int entityId) {
        return vehiclesByEntityId.get(entityId);
    }

    public int entityCount() {
        return vehiclesByEntityId.size();
    }

    public int participantCount() {
        return participants.size();
    }
}
