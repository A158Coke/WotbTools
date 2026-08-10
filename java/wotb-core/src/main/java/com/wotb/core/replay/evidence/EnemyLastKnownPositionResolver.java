package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.PlayerSideResolver;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.MapRegionResolver;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ObservationState;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.VehicleState;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 敌方最后已知位置聚合（AI 复盘"敌方走位"特征）。
 * <p>输入最终战场状态快照（{@link ReplayReconstruction#finalState()}）+ 权威名册
 * （{@code battle.players}）+ perspective 队伍，输出每辆敌方车辆的最后已知位置记录。
 * 只统计 {@code observationState == OBSERVED} 且位置已知的车辆；STALE / UNKNOWN /
 * REMOVED 或 position 为 null 一律视为无记录，输出 UNKNOWN 行（无位置/无时间），
 * 绝不把观测子集伪装成全知。</p>
 * <p>行数按名册中的敌方玩家逐车输出（每名敌方玩家必有一行）；昵称与坦克名来自
 * 名册映射 + {@link ReplayDisplayNames}。置信度口径沿用 {@link NearbySupportCounter}：
 * 全部敌方玩家都有 OBSERVED 记录 → EXACT，覆盖不全 → PARTIAL，名册无敌方 → UNKNOWN。</p>
 */
public final class EnemyLastKnownPositionResolver {

    /**
     * 敌方单车的最后已知位置记录。
     * <p>{@code observed=false}（UNKNOWN 行）时 region=0、distanceMeters/lastObservedBattleSec
     * 均为 null；{@code observed=true} 时 region 为九宫格 1-9（不可用为 0），
     * distanceMeters 为距 perspective 方 OBSERVED 有位置车辆质心的 canonical 距离（米，
     * 无质心时为 null），lastObservedBattleSec 为 battle-relative 秒（开战前观察为 null）。</p>
     */
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

    /** 整体结果：逐车记录 + 覆盖计数 + 置信度。 */
    public record EnemyLastKnownPositionResult(
            List<EnemyLastKnownPosition> vehicles,
            int observedCount,
            int totalCount,
            DecodeConfidence confidence
    ) {
        /** 敌方一侧是否全部有 OBSERVED 记录（可表达完整覆盖）。 */
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

        // 我方质心：仅 perspective 方 OBSERVED 且有位置的车辆
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

    /**
     * 最后观察时间（battle-relative）：lastPositionAt 减 battleStartRawClockSec。
     * 任一无值或观察发生在开战前（相对时间为负）时返回 null，避免输出误导性时间。
     */
    private static Float battleRelativeSec(final VehicleState vs, final Float battleStart) {
        if (vs.lastPositionAt() == null || battleStart == null) {
            return null;
        }
        final float rel = vs.lastPositionAt() - battleStart;
        return rel >= 0f ? rel : null;
    }

    /** 按 accountId 查车辆状态：先走快照 entityIdByAccountId 索引，失败时线性回退。 */
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

    /** perspective 方 OBSERVED 且有位置车辆的原始坐标质心；无则 null。 */
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

    /** 车辆归属队伍：VehicleState.team 优先，accountId→名册回退（与 NearbySupportCounter 一致）。 */
    private static Integer teamOf(final VehicleState vs, final Map<Long, Integer> teamByAccountId) {
        if (vs.team() != null) {
            return vs.team();
        }
        final Long accountId = vs.accountId();
        return accountId == null ? null : teamByAccountId.get(accountId);
    }
}
