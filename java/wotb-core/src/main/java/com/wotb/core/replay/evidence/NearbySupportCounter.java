package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.MapRegionResolver;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.ObservationState;
import com.wotb.core.replay.reconstruction.VehicleState;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 局部支援计数（文档 §14 LOCAL_SUPPORT 的确定性基础）。
 * <p>只统计 {@code observationState == OBSERVED} 且位置已知的实体；
 * STALE / UNKNOWN / REMOVED 一律不计入。敌军数量表达为"至少观察到 N 个附近敌军"，
 * 只有该侧全部实体都被观察到时才可表达为完整数量；两侧都完整覆盖时才允许 EXACT。</p>
 */
public final class NearbySupportCounter {

    public static final float SUPPORT_RADIUS_M = 150f;

    /**
     * 某时刻录像者附近的友军 / 敌军观察数量。
     */
    public record Counts(
            float battleRelSec,
            int friendlyCount,
            int enemyCount,
            int observedFriendlyTotal,
            int observedEnemyTotal,
            int friendlyTotal,
            int enemyTotal,
            int recorderRegion,
            DecodeConfidence confidence
    ) {
        /**
         * 友军一侧是否全部被观察到（可表达完整数量）。
         */
        public boolean friendlyFullyObserved() {
            return friendlyTotal > 0 && observedFriendlyTotal == friendlyTotal;
        }

        /**
         * 敌军一侧是否全部被观察到（可表达完整数量）。
         */
        public boolean enemyFullyObserved() {
            return enemyTotal > 0 && observedEnemyTotal == enemyTotal;
        }

        /**
         * 友军数量标签：完整覆盖时 "N"，否则 "≥N"（N=0 时 "?"）。
         */
        public String friendlyLabel() {
            return label(friendlyCount, friendlyFullyObserved());
        }

        /**
         * 敌军数量标签：完整覆盖时 "N"，否则 "≥N"（N=0 时 "?"）。
         */
        public String enemyLabel() {
            return label(enemyCount, enemyFullyObserved());
        }

        /**
         * "友军v敌军" 形式标签，避免把观察子集伪装成全知兵力。
         */
        public String numbersLabel() {
            return friendlyLabel() + "v" + enemyLabel();
        }

        private static String label(final int count, final boolean fullyObserved) {
            if (fullyObserved) {
                return String.valueOf(count);
            }
            return count > 0 ? "≥" + count : "?";
        }
    }

    private NearbySupportCounter() {
    }

    /**
     * @return 无法定位录像者 / 无检查点时返回 null
     */
    public static Counts at(
            final List<BattleStateCheckpoint> checkpoints,
            final float battleStartRawClockSec,
            final float battleRelSec,
            final int recorderEntityId,
            final Battle battle
    ) {
        if (checkpoints == null || checkpoints.isEmpty() || recorderEntityId <= 0) {
            return null;
        }
        final List<BattleStateCheckpoint> sorted = new ArrayList<>(checkpoints);
        sorted.sort(Comparator.comparingDouble(BattleStateCheckpoint::rawClockSec));
        final BattleStateCheckpoint cp = closestAtOrBefore(sorted, battleStartRawClockSec + battleRelSec);
        if (cp == null) {
            return null;
        }
        final VehicleState recorder = cp.stateSnapshot().vehicleByEntityId(recorderEntityId);
        if (recorder == null || recorder.position() == null
                || recorder.observationState() != ObservationState.OBSERVED) {
            return null;
        }
        if (recorder.team() == null) {
            return null;
        }
        final Map<Long, Integer> teamByAccountId = teamByAccountId(battle);
        // denominator 使用当前时间点的存活名单：已阵亡车辆不污染观察覆盖
        final int[] totals = sideTotals(battle, recorder.team(), battleRelSec);
        int friendly = 0;
        int enemy = 0;
        int observedFriendly = 0;
        int observedEnemy = 0;
        for (final VehicleState vs : cp.stateSnapshot().vehiclesByEntityId().values()) {
            if (vs.entityId() == recorderEntityId) {
                continue;
            }
            if (vs.position() == null || vs.observationState() != ObservationState.OBSERVED) {
                continue;
            }
            final Integer team = teamOf(vs, teamByAccountId);
            if (team == null) {
                continue;
            }
            if (team == recorder.team()) {
                observedFriendly++;
                if (inRadius(recorder, vs, battle.mapName)) {
                    friendly++;
                }
            } else {
                observedEnemy++;
                if (inRadius(recorder, vs, battle.mapName)) {
                    enemy++;
                }
            }
        }
        final boolean friendlyFully = totals[0] > 0 && observedFriendly == totals[0];
        final boolean enemyFully = totals[1] > 0 && observedEnemy == totals[1];
        final DecodeConfidence confidence = friendlyFully && enemyFully
                ? DecodeConfidence.EXACT : DecodeConfidence.PARTIAL;
        final int recorderRegion = MapRegionResolver.resolveRegionFromRaw(
                recorder.position().x(), recorder.position().z(), battle.mapName);
        return new Counts(battleRelSec, friendly, enemy, observedFriendly, observedEnemy,
                totals[0], totals[1], recorderRegion, confidence);
    }

    /**
     * 当前时间点存活队伍人数（来自 battle 结算）：[友军(不含录像者), 敌军]。
     */
    private static int[] sideTotals(final Battle battle, final int recorderTeam,
                                    final float battleRelSec) {
        int friendly = 0;
        int enemy = 0;
        if (battle.players != null) {
            for (final PlayerResult p : battle.players) {
                if (!aliveAt(p, battleRelSec)) {
                    continue;
                }
                if (p.team == recorderTeam) {
                    friendly++;
                } else {
                    enemy++;
                }
            }
        }
        // 录像者本人恒不进入附近计数，友军侧应排除他
        return new int[]{Math.max(0, friendly - 1), enemy};
    }

    /**
     * 权威存活判定：survived，或阵亡时间晚于当前 battle-relative 时刻。
     */
    private static boolean aliveAt(final PlayerResult p, final float battleRelSec) {
        if (p.survived) {
            return true;
        }
        return PlayerResultFormat.deathSec(p) > battleRelSec;
    }

    private static boolean inRadius(final VehicleState recorder, final VehicleState other,
                                    final String mapCode) {
        final float distance = MapRegionResolver.canonicalDistanceMeters(
                recorder.position().x(), recorder.position().z(),
                other.position().x(), other.position().z(), mapCode);
        return distance >= 0f && distance <= SUPPORT_RADIUS_M;
    }

    private static BattleStateCheckpoint closestAtOrBefore(
            final List<BattleStateCheckpoint> checkpoints, final float targetRaw) {
        BattleStateCheckpoint best = null;
        for (final BattleStateCheckpoint cp : checkpoints) {
            if (cp.rawClockSec() > targetRaw) {
                break;
            }
            best = cp;
        }
        return best;
    }

    private static Map<Long, Integer> teamByAccountId(final Battle battle) {
        final Map<Long, Integer> map = new HashMap<>();
        if (battle.players != null) {
            for (final PlayerResult p : battle.players) {
                if (p.accountId > 0) {
                    map.put(p.accountId, p.team);
                }
            }
        }
        return map;
    }

    private static Integer teamOf(final VehicleState vs, final Map<Long, Integer> teamByAccountId) {
        if (vs.team() != null) {
            return vs.team();
        }
        final Long accountId = vs.accountId();
        return accountId == null ? null : teamByAccountId.get(accountId);
    }
}
