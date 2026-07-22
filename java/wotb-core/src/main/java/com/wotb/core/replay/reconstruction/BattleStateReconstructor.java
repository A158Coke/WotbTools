package com.wotb.core.replay.reconstruction;

import com.wotb.core.replay.event.BattleEndedEvent;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.EntityCreatedEvent;
import com.wotb.core.replay.event.EntityRemovedEvent;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.VehicleDestroyedEvent;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 战场状态重建器。
 * <p>
 * 按时间和原始顺序依次应用领域事件，重建整场回放的战场状态。
 * 同时维护 checkpoint 以支持快速任意时刻状态查询。
 * </p>
 */
public class BattleStateReconstructor {

    /** 默认 checkpoint 间隔（秒） */
    static final float DEFAULT_CHECKPOINT_INTERVAL_SEC = 1.0f;

    /** 默认事件数量间隔 checkpoint */
    static final int DEFAULT_CHECKPOINT_EVENT_INTERVAL = 500;

    private final float checkpointIntervalSec;
    private final int checkpointEventInterval;
    private final Float battleStartRawClockSec;

    private float lastCheckpointClock = -Float.MAX_VALUE;
    private int lastCheckpointEventIndex = 0;

    /**
     * 创建重建器。
     *
     * @param battleStartRawClockSec 战斗开始原始时钟（可为 null）
     * @param checkpointIntervalSec  checkpoint 时间间隔（秒）
     * @param checkpointEventInterval checkpoint 事件数量间隔
     */
    public BattleStateReconstructor(
            Float battleStartRawClockSec,
            float checkpointIntervalSec,
            int checkpointEventInterval) {
        this.battleStartRawClockSec = battleStartRawClockSec;
        this.checkpointIntervalSec = checkpointIntervalSec;
        this.checkpointEventInterval = checkpointEventInterval;
    }

    /**
     * 使用默认 checkpoint 配置创建重建器。
     */
    public BattleStateReconstructor() {
        this(null, DEFAULT_CHECKPOINT_INTERVAL_SEC, DEFAULT_CHECKPOINT_EVENT_INTERVAL);
    }

    /**
     * 重建战场状态。
     *
     * @param events 按时间和原始顺序排列的领域事件列表
     * @return 重建结果，包含最终状态和 checkpoint 列表
     */
    public ReconstructionResult reconstruct(List<ReplayEvent> events) {
        final BattleState state = new BattleState();
        final List<ReplayEvent> processedEvents = new ArrayList<>();
        final List<BattleStateCheckpoint> checkpoints = new ArrayList<>();

        // 生成初始 checkpoint
        checkpoints.add(new BattleStateCheckpoint(0f, 0, BattleStateSnapshot.from(state)));

        for (final ReplayEvent event : events) {
            applyEvent(state, event);
            processedEvents.add(event);

            // 更新 state 时钟
            final float rawClockSec = event.timestamp().rawClockSec();
            state.setRawClockSec(rawClockSec);
            if (battleStartRawClockSec != null) {
                state.setBattleClockSec(rawClockSec - battleStartRawClockSec);
            }

            // 判断是否需要生成 checkpoint
            final boolean timeBased = rawClockSec - lastCheckpointClock >= checkpointIntervalSec;
            final boolean eventBased = processedEvents.size() - lastCheckpointEventIndex >= checkpointEventInterval;

            if (timeBased || eventBased) {
                checkpoints.add(new BattleStateCheckpoint(
                        rawClockSec,
                        processedEvents.size(),
                        BattleStateSnapshot.from(state)));
                lastCheckpointClock = rawClockSec;
                lastCheckpointEventIndex = processedEvents.size();
            }
        }

        // 终态 checkpoint
        final BattleStateSnapshot finalSnapshot = BattleStateSnapshot.from(state);
        if (checkpoints.isEmpty() || checkpoints.getLast().eventIndex() < processedEvents.size()) {
            checkpoints.add(new BattleStateCheckpoint(
                    state.getRawClockSec(),
                    processedEvents.size(),
                    finalSnapshot));
        }

        return new ReconstructionResult(state, finalSnapshot, processedEvents, checkpoints);
    }

    /**
     * 应用单个事件到战场状态。
     */
    private void applyEvent(BattleState state, ReplayEvent event) {
        switch (event) {
            case PositionChangedEvent e -> applyPosition(state, e);
            case DamageEvent e -> applyDamage(state, e);
            case EntityRemovedEvent e -> applyEntityRemoved(state, e);
            case VehicleDestroyedEvent e -> applyVehicleDestroyed(state, e);
            case BattleEndedEvent e -> applyBattleEnded(state, e);
            case HealthChangedEvent e -> applyHealth(state, e);
            case EntityCreatedEvent e -> applyEntityCreated(state, e);
            case ParticipantMappingEvent e -> applyMapping(state, e);
            default -> {
                // UnknownReplayEvent 等不需要改变状态
            }
        }
    }

    private void applyPosition(BattleState state, PositionChangedEvent e) {
        final VehicleState vs = state.getOrCreateVehicle(e.entityId(), e.timestamp().rawClockSec());
        vs.setLastObservedAt(e.timestamp().rawClockSec());

        // 如果已经确认为 DESTROYED，低置信度（PARTIAL/UNKNOWN）位置更新不得覆盖，
        // 只接受高置信度（EXACT/INFERRED）数据。与 applyVehicleDestroyed/applyHealth 的处理一致。
        if (vs.lifeState() == LifeState.DESTROYED
                && DecodeConfidenceHelper.ordinal(e.confidence()) >= DecodeConfidenceHelper.ordinal(
                        com.wotb.core.replay.event.DecodeConfidence.PARTIAL)) {
            return;
        }

        try {
            vs.setPosition(new Vector3(e.x(), e.y(), e.z()));
        } catch (IllegalArgumentException ignored) {
            // NaN/Infinity position — skip
        }
        try {
            vs.setRotation(new Rotation(e.yaw(), e.pitch(), e.roll()));
        } catch (IllegalArgumentException ignored) {
        }

        if (vs.observationState() == ObservationState.UNKNOWN) {
            vs.setObservationState(ObservationState.OBSERVED);
        }
        // 如果已被移除但出现新位置，更新状态
        if (vs.observationState() == ObservationState.REMOVED) {
            vs.setObservationState(ObservationState.OBSERVED);
        }
    }

    private void applyDamage(BattleState state, DamageEvent e) {
        // 攻击者
        if (e.attackerEid() != e.victimEid()) {
            final VehicleState attacker = state.getOrCreateVehicle(e.attackerEid(), e.timestamp().rawClockSec());
            attacker.setLastObservedAt(e.timestamp().rawClockSec());
            attacker.addDamageDealt(e.damage());
        }

        // 受击者
        final VehicleState victim = state.getOrCreateVehicle(e.victimEid(), e.timestamp().rawClockSec());
        victim.setLastObservedAt(e.timestamp().rawClockSec());
        victim.addDamageReceived(e.damage());
    }

    private void applyEntityRemoved(BattleState state, EntityRemovedEvent e) {
        final VehicleState vs = state.getVehicle(e.entityId());
        if (vs != null) {
            vs.setRemovedAt(e.timestamp().rawClockSec());
            // 注意：不能设置 DESTROYED，EntityLeave 不等同于阵亡
            vs.setObservationState(ObservationState.REMOVED);
        }
    }

    private void applyVehicleDestroyed(BattleState state, VehicleDestroyedEvent e) {
        final VehicleState vs = state.getOrCreateVehicle(e.entityId(), e.timestamp().rawClockSec());
        if (vs.lifeState() == LifeState.DESTROYED && e.inferred()) {
            return; // 已确认击毁，低置信度事件不能覆盖
        }
        vs.setLastObservedAt(e.timestamp().rawClockSec());
        vs.setLifeState(LifeState.DESTROYED);
        vs.setObservationState(ObservationState.REMOVED);
    }

    private void applyBattleEnded(BattleState state, BattleEndedEvent e) {
        state.setBattleEnded(true);
        state.setLifecycle(BattleLifecycle.FINISHED);
        if (e.winnerTeam() != null) {
            state.setWinnerTeam(e.winnerTeam());
        }
    }

    private void applyHealth(BattleState state, HealthChangedEvent e) {
        final VehicleState vs = state.getOrCreateVehicle(e.entityId(), e.timestamp().rawClockSec());
        vs.setLastObservedAt(e.timestamp().rawClockSec());

        if (e.currentHealth() != null) {
            // 如果字段解析置信度不足，不得覆盖高置信度值
            if (e.confidence() == com.wotb.core.replay.event.DecodeConfidence.PARTIAL
                    && vs.currentHealth() != null
                    && vs.lifeState() == LifeState.DESTROYED) {
                // 低置信度，不覆盖已确认阵亡状态
            } else {
                vs.setCurrentHealth(e.currentHealth());
            }
        }
        if (e.maxHealth() != null) {
            vs.setMaxHealth(e.maxHealth());
        }
        if (e.alive() != null) {
            if (!e.alive() && vs.lifeState() != LifeState.DESTROYED) {
                vs.setLifeState(LifeState.DESTROYED);
                vs.setObservationState(ObservationState.REMOVED);
            } else if (e.alive()) {
                vs.setLifeState(LifeState.ALIVE);
            }
        }
    }

    private void applyEntityCreated(BattleState state, EntityCreatedEvent e) {
        state.getOrCreateVehicle(e.entityId(), e.timestamp().rawClockSec());
    }

    private void applyMapping(BattleState state, ParticipantMappingEvent e) {
        state.registerMapping(e.entityId(), e.accountId());
    }

    /**
     * 在给定时间点查询战场状态。
     *
     * @param targetClockSec 目标时间（原始时钟）
     * @param events         全部领域事件列表
     * @param checkpoints    checkpoint 列表
     * @return 目标时间的战场状态快照
     */
    public static BattleStateSnapshot stateAt(
            float targetClockSec,
            List<ReplayEvent> events,
            List<BattleStateCheckpoint> checkpoints) {

        // 时钟可能回退（诊断中的 clockRegressionCount 可 > 0）：不能假设 events 的
        // rawClockSec 单调递增，也不能在遇到第一个"超过目标时间"的事件时 break，
        // 否则其后 sequence 更大但时钟更小的事件会被永久漏掉，checkpoint 快路径同理不安全。
        // 因此按原始 sequence 顺序，从空态重放所有 rawClockSec <= targetClockSec 的事件
        // （跳过晚于目标时间的），保证与完整重建在该时间点的结果一致。
        // checkpoints 仍保留在重建结果中供未来（无回退时）快速查询优化使用。
        final BattleState state = new BattleState();
        final BattleStateReconstructor replayer = new BattleStateReconstructor();
        float maxAppliedClock = 0f;
        boolean anyApplied = false;
        for (final ReplayEvent event : events) {
            final float clock = event.timestamp().rawClockSec();
            if (clock > targetClockSec) {
                continue;
            }
            replayer.applyEvent(state, event);
            if (!anyApplied || clock > maxAppliedClock) {
                maxAppliedClock = clock;
                anyApplied = true;
            }
        }
        state.setRawClockSec(anyApplied ? maxAppliedClock : 0f);

        return BattleStateSnapshot.from(state);
    }

    /**
     * 重建结果。
     */
    public record ReconstructionResult(
            BattleState finalState,
            BattleStateSnapshot finalSnapshot,
            List<ReplayEvent> processedEvents,
            List<BattleStateCheckpoint> checkpoints
    ) {
    }
}

// 辅助比较类（用于置信度比较，放在文件末尾以避免冲突）
final class DecodeConfidenceHelper {
    private DecodeConfidenceHelper() {}

    static int ordinal(com.wotb.core.replay.event.DecodeConfidence c) {
        return switch (c) {
            case EXACT -> 0;
            case INFERRED -> 1;
            case PARTIAL -> 2;
            case UNKNOWN -> 3;
        };
    }
}
