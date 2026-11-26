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
import java.util.Objects;

public final class NearbySupportCounter {

    public static final float SUPPORT_RADIUS_M = 150f;

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
        public boolean friendlyFullyObserved() {
            return friendlyTotal > 0 && observedFriendlyTotal == friendlyTotal;
        }

        public boolean enemyFullyObserved() {
            return enemyTotal > 0 && observedEnemyTotal == enemyTotal;
        }

        public String friendlyLabel() {
            return label(friendlyCount, friendlyFullyObserved());
        }

        public String enemyLabel() {
            return label(enemyCount, enemyFullyObserved());
        }

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
            if (Objects.equals(team, recorder.team())) {
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

    private static int[] sideTotals(final Battle battle, final int recorderTeam,
                                    final float battleRelSec) {
        int friendly = 0;
        int enemy = 0;
        if (battle.players != null) {
            for (final PlayerResult p : battle.players) {
                if (!aliveAt(battle, p, battleRelSec)) {
                    continue;
                }
                if (p.team == recorderTeam) {
                    friendly++;
                } else {
                    enemy++;
                }
            }
        }
        return new int[]{Math.max(0, friendly - 1), enemy};
    }

    private static boolean aliveAt(final Battle battle, final PlayerResult p, final float battleRelSec) {
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
