package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.MapRegionResolver;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.ObservationState;
import com.wotb.core.replay.reconstruction.VehicleState;

import java.util.HashMap;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * 局部支援计数（文档 §14 LOCAL_SUPPORT 的确定性基础）。
 * <p>只统计 {@code observationState == OBSERVED} 且位置已知的实体；
 * STALE / UNKNOWN / REMOVED 一律不计入，避免把未知位置当成"不在附近"。</p>
 */
public final class NearbySupportCounter {

    public static final float SUPPORT_RADIUS_M = 150f;

    /** 某时刻录像者附近的友军 / 敌军数量。 */
    public record Counts(
            float battleRelSec,
            int friendlyCount,
            int enemyCount,
            int observedFriendlyTotal,
            int observedEnemyTotal,
            int recorderRegion,
            DecodeConfidence confidence
    ) {
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
                if (inRadius(recorder, vs)) {
                    friendly++;
                }
            } else {
                observedEnemy++;
                if (inRadius(recorder, vs)) {
                    enemy++;
                }
            }
        }
        final int recorderRegion = MapRegionResolver.resolveRegionFromRaw(
                recorder.position().x(), recorder.position().z());
        final DecodeConfidence confidence = observedEnemy >= 2
                ? DecodeConfidence.EXACT : DecodeConfidence.PARTIAL;
        return new Counts(battleRelSec, friendly, enemy, observedFriendly, observedEnemy,
                recorderRegion, confidence);
    }

    private static boolean inRadius(final VehicleState recorder, final VehicleState other) {
        final float distance = MapRegionResolver.canonicalDistanceMeters(
                recorder.position().x(), recorder.position().z(),
                other.position().x(), other.position().z());
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
