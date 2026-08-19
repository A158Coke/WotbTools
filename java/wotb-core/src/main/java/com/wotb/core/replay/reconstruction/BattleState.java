package com.wotb.core.replay.reconstruction;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 可变的战场状态，用于 reconstruction 过程中的状态更新。
 * <p>
 * 核心状态模型，包含当前回放时钟、战斗阶段、已知玩家和实体。
 * 事件通过 applier 应用到此状态。
 * </p>
 */
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

    // ---- Getters ----

    public float getRawClockSec() { return rawClockSec; }
    public Float getBattleClockSec() { return battleClockSec; }
    public BattleLifecycle getLifecycle() { return lifecycle; }
    public Map<Integer, VehicleState> getVehiclesByEntityId() { return vehiclesByEntityId; }
    public Map<Long, Integer> getEntityIdByAccountId() { return entityIdByAccountId; }
    public List<BattleParticipant> getParticipants() { return participants; }
    public boolean isBattleEnded() { return battleEnded; }
    public Integer getWinnerTeam() { return winnerTeam; }

    // ---- Setters ----

    public void setRawClockSec(float rawClockSec) { this.rawClockSec = rawClockSec; }
    public void setBattleClockSec(Float battleClockSec) { this.battleClockSec = battleClockSec; }
    public void setLifecycle(BattleLifecycle lifecycle) { this.lifecycle = lifecycle; }
    public void setBattleEnded(boolean battleEnded) { this.battleEnded = battleEnded; }
    public void setWinnerTeam(Integer winnerTeam) { this.winnerTeam = winnerTeam; }

    // ---- Entity management ----

    /**
     * 获取或创建实体状态。
     */
    public VehicleState getOrCreateVehicle(int entityId, float clockSec) {
        return vehiclesByEntityId.computeIfAbsent(entityId, k -> {
            final VehicleState vs = new VehicleState(entityId, clockSec);
            vs.setObservationState(ObservationState.OBSERVED);
            return vs;
        });
    }

    /**
     * 注册参与者映射。
     */
    public void registerMapping(int entityId, long accountId) {
        entityIdByAccountId.put(accountId, entityId);
        final VehicleState vs = vehiclesByEntityId.get(entityId);
        if (vs != null) {
            vs.setAccountId(accountId);
        }
    }

    /**
     * 添加参与者信息。
     */
    public void addParticipant(BattleParticipant participant) {
        participants.add(participant);
    }

    /**
     * 根据 accountId 查找实体 ID。
     */
    public Integer getEntityIdByAccountId(long accountId) {
        return entityIdByAccountId.get(accountId);
    }

    /**
     * 根据 entityId 查找车辆状态。
     */
    public VehicleState getVehicle(int entityId) {
        return vehiclesByEntityId.get(entityId);
    }

    /**
     * 返回当前已知实体的数量。
     */
    public int entityCount() {
        return vehiclesByEntityId.size();
    }

    /**
     * 返回当前已注册参与者的数量。
     */
    public int participantCount() {
        return participants.size();
    }
}
