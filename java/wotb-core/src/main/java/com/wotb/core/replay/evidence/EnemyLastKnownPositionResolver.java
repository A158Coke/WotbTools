package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.MapRegionResolver;
import com.wotb.core.replay.processing.PlayerSideResolver;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ObservationState;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.VehicleState;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class EnemyLastKnownPositionResolver {

    public record EnemyLastKnownPosition(
            long accountId,
            String nickname,
            String tankName,
            int region,
            Float distanceMeters,
            Float lastObservedBattleSec,
            boolean observed
    ) {
        public boolean unknown() {
            return !observed;
        }
    }

    public record EnemyLastKnownPositionResult(
            List<EnemyLastKnownPosition> vehicles,
            int observedCount,
            int totalCount,
            DecodeConfidence confidence
    ) {
        public boolean enemyFullyObserved() {
            return totalCount > 0 && observedCount == totalCount;
        }
    }

    private EnemyLastKnownPositionResolver() {
    }

    /**
     * @param recon           完整重建（取其 finalState 与 battleStartRawClockSec）
     * @param battle          权威结算（名册）
     * @param perspectiveTeam 视角队伍（1 或 2），敌方 = 名册中非该队玩家
     * @return 前置条件不满足（无重建/无名册/非法视角）时返回 null
     */
    public static EnemyLastKnownPositionResult resolve(
            final ReplayReconstruction recon,
            final Battle battle,
            final int perspectiveTeam
    ) {
        if (recon == null || recon.finalState() == null
                || battle == null || battle.players == null
                || !PlayerSideResolver.isValidRawTeam(perspectiveTeam)) {
            return null;
        }
        final Float battleStart = recon.battleStartRawClockSec();
        final Map<Long, Integer> teamByAccountId = teamByAccountId(battle);
        final BattleStateSnapshot snapshot = recon.finalState();
        final Map<Integer, VehicleState> vehicles = snapshot.vehiclesByEntityId();

        final float[] centroid = perspectiveCentroid(vehicles, teamByAccountId, perspectiveTeam);

        final List<EnemyLastKnownPosition> rows = new ArrayList<>();
        int observedCount = 0;
        for (final PlayerResult p : battle.players) {
            if (!PlayerSideResolver.isValidRawTeam(p.team) || p.team == perspectiveTeam) {
                continue;
            }
            final VehicleState vs = vehicleByAccountId(vehicles, snapshot, p.accountId);
            final boolean hasRecord = vs != null
                    && vs.observationState() == ObservationState.OBSERVED
                    && vs.position() != null;
            int region = 0;
            Float distance = null;
            Float relSec = null;
            if (hasRecord) {
                final float x = vs.position().x();
                final float z = vs.position().z();
                region = MapRegionResolver.resolveRegionFromRaw(x, z, battle.mapName);
                if (centroid != null) {
                    final float d = MapRegionResolver.canonicalDistanceMeters(
                            x, z, centroid[0], centroid[1], battle.mapName);
                    if (d >= 0f) {
                        distance = d;
                    }
                }
                relSec = battleRelativeSec(vs, battleStart);
                observedCount++;
            }
            rows.add(new EnemyLastKnownPosition(
                    p.accountId,
                    p.nickname == null ? "" : p.nickname,
                    ReplayDisplayNames.tankName(p.tankId, p.tankName),
                    region, distance, relSec, hasRecord));
        }
        final int totalCount = rows.size();
        final DecodeConfidence confidence = totalCount == 0 ? DecodeConfidence.UNKNOWN
                : (observedCount == totalCount ? DecodeConfidence.EXACT
                : DecodeConfidence.PARTIAL);
        return new EnemyLastKnownPositionResult(
                List.copyOf(rows), observedCount, totalCount, confidence);
    }

    private static Float battleRelativeSec(final VehicleState vs, final Float battleStart) {
        if (vs.lastPositionAt() == null || battleStart == null) {
            return null;
        }
        final float rel = vs.lastPositionAt() - battleStart;
        return rel >= 0f ? rel : null;
    }

    private static VehicleState vehicleByAccountId(
            final Map<Integer, VehicleState> vehicles,
            final BattleStateSnapshot snapshot,
            final long accountId) {
        if (accountId > 0) {
            final Integer entityId = snapshot.entityIdByAccountId(accountId);
            if (entityId != null) {
                final VehicleState direct = vehicles.get(entityId);
                if (direct != null) {
                    return direct;
                }
            }
        }
        for (final VehicleState vs : vehicles.values()) {
            if (vs.accountId() != null && vs.accountId() == accountId) {
                return vs;
            }
        }
        return null;
    }

    private static float[] perspectiveCentroid(
            final Map<Integer, VehicleState> vehicles,
            final Map<Long, Integer> teamByAccountId,
            final int perspectiveTeam) {
        float sumX = 0f;
        float sumZ = 0f;
        int count = 0;
        for (final VehicleState vs : vehicles.values()) {
            if (vs.position() == null || vs.observationState() != ObservationState.OBSERVED) {
                continue;
            }
            final Integer team = teamOf(vs, teamByAccountId);
            if (team == null || team != perspectiveTeam) {
                continue;
            }
            sumX += vs.position().x();
            sumZ += vs.position().z();
            count++;
        }
        return count == 0 ? null : new float[]{sumX / count, sumZ / count};
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
