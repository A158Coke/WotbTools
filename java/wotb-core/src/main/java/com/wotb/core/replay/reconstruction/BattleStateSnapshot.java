package com.wotb.core.replay.reconstruction;

import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 战场状态在某一时刻的快照（不可变）。
 * <p>
 * 包含了查询 {@code stateAt(time)} 所需的所有信息。
 * 不保存完整领域事件列表，只保存当前战场状态的深拷贝。
 * </p>
 */
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

    /**
     * 根据 entityId 查询车辆状态。
     */
    public VehicleState vehicleByEntityId(int entityId) {
        return vehiclesByEntityId.get(entityId);
    }

    /**
     * 根据 accountId 查询实体 ID。
     */
    public Integer entityIdByAccountId(long accountId) {
        return entityIdByAccountId.get(accountId);
    }

    /**
     * 获取所有已知实体的数量。
     */
    public int entityCount() {
        return vehiclesByEntityId.size();
    }

    /**
     * 获取所有参与者的数量。
     */
    public int participantCount() {
        return participants.size();
    }

    /**
     * 创建一个空的初始快照。
     */
    public static BattleStateSnapshot empty() {
        return new BattleStateSnapshot(
                0f, null, BattleLifecycle.PRE_BATTLE,
                Collections.emptyMap(), Collections.emptyMap(),
                List.of(), false, null);
    }

    /**
     * 从BattleState构建不可变快照（深拷贝车辆状态）。
     */
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
