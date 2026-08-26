package com.wotb.core.replay.feature;

import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.PositionChangedEvent;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 团队队形/区域提取器：按固定窗口聚合成员位置，生成 TeamFormationPhase（质心/离散度/
 * 结构化 TeamFormationCluster），并负责位置证据的空间门禁（可解析/越界/钳制判定）。
 * <p>从 {@link DefaultTeamBattleFeatureExtractor} 拆出，纯静态工具类，不做编排。</p>
 */
final class TeamFormationExtractor {

    private TeamFormationExtractor() {
    }

    static final float FORMATION_WINDOW_SEC = 15f;
    static final float FORMATION_CLUSTER_DISTANCE_METERS = 100f; // canonical meters
    static final float MAX_ABSOLUTE_ELEVATION = 200f;

    static List<TeamFormationPhase> buildFormationPhases(
            final Map<Integer, List<DefaultTeamBattleFeatureExtractor.TimedTeamPosition>> timedPositionsByEntity,
            final TeamEntityMapping mapping,
            final int perspectiveTeam,
            final String mapCode
    ) {
        final Map<Integer, Map<String, PositionChangedEvent>> windows = new HashMap<>();
        timedPositionsByEntity.forEach((entityId, timedPositions) -> {
            final TeamEntityIdentity identity = mapping.identity(entityId);
            if (identity == null || identity.team() != perspectiveTeam) {
                return;
            }
            for (final DefaultTeamBattleFeatureExtractor.TimedTeamPosition timedPos : timedPositions) {
                    final float activeClock = timedPos.battleRelativeSec();
                    final int window = (int) Math.floor(activeClock / FORMATION_WINDOW_SEC);
                    windows.computeIfAbsent(window, ignored -> new HashMap<>())
                            .merge(DefaultTeamBattleFeatureExtractor.identityKey(identity), timedPos.event(),
                                    (left, right) -> left.sequence() > right.sequence() ? left : right);
            }
        });
        return windows.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(entry -> formationPhase(entry.getKey(), entry.getValue(), mapCode))
                .filter(phase -> phase != null)
                .toList();
    }

    static TeamFormationPhase formationPhase(
            final int window,
            final Map<String, PositionChangedEvent> positionsByMember,
            final String mapCode
    ) {
        final List<Map.Entry<String, PositionChangedEvent>> sorted = positionsByMember.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .toList();
        final List<CanonicalMapPosition> canonicalPositions = sorted.stream()
                .map(Map.Entry::getValue)
                .map(pos -> MapRegionResolver.resolve(pos.x(), pos.z(), mapCode))
                .filter(MapCoordinateResolution::usable)
                .map(MapCoordinateResolution::position)
                .toList();
        if (canonicalPositions.isEmpty()) {
            return null;
        }
        final float centroidX = (float) canonicalPositions.stream()
                .mapToDouble(CanonicalMapPosition::x)
                .average()
                .orElse(0.0);
        final float centroidZ = (float) canonicalPositions.stream()
                .mapToDouble(CanonicalMapPosition::z)
                .average()
                .orElse(0.0);
        final float dispersion = (float) canonicalPositions.stream()
                .mapToDouble(pos -> distance(
                        pos.x(), pos.z(), centroidX, centroidZ))
                .average()
                .orElse(0.0);
        final DecodeConfidence confidence = sorted.stream()
                .map(Map.Entry::getValue)
                .map(PositionChangedEvent::confidence)
                .reduce(DecodeConfidence.EXACT, DefaultTeamBattleFeatureExtractor::lowerConfidence);

        // Build structured clusters
        final float windowStart = window * FORMATION_WINDOW_SEC;
        final float windowEnd = (window + 1) * FORMATION_WINDOW_SEC;
        final List<TeamFormationCluster> clusters = buildClusters(sorted, windowStart, windowEnd, mapCode);

        return new TeamFormationPhase(
                window * FORMATION_WINDOW_SEC,
                (window + 1) * FORMATION_WINDOW_SEC,
                new CanonicalMapPosition(centroidX, centroidZ),
                dispersion,
                canonicalPositions.size(),
                confidence,
                clusters);
    }

    /**
     * Build structured clusters from sorted (identityKey, position) entries using BFS.
     */
    static List<TeamFormationCluster> buildClusters(
            final List<Map.Entry<String, PositionChangedEvent>> sorted,
            final float startTime,
            final float endTime,
            final String mapCode
    ) {
        if (sorted.isEmpty()) return List.of();
        final boolean[] visited = new boolean[sorted.size()];
        final List<TeamFormationCluster> result = new ArrayList<>();

        for (int start = 0; start < sorted.size(); start++) {
            if (visited[start]) continue;
            final List<Integer> clusterIndices = new ArrayList<>();
            final List<Integer> queue = new ArrayList<>();
            queue.add(start);
            visited[start] = true;
            while (!queue.isEmpty()) {
                final int current = queue.removeFirst();
                clusterIndices.add(current);
                final PositionChangedEvent currentPos = sorted.get(current).getValue();
                for (int candidate = 0; candidate < sorted.size(); candidate++) {
                    if (!visited[candidate] && canonicalDistance(
                            currentPos.x(), currentPos.z(),
                            sorted.get(candidate).getValue().x(),
                            sorted.get(candidate).getValue().z(), mapCode)
                            <= FORMATION_CLUSTER_DISTANCE_METERS) {
                        visited[candidate] = true;
                        queue.add(candidate);
                    }
                }
            }

            // Resolve/clamp EACH member position to canonical FIRST, then average in canonical
            // space. Averaging raw coordinates before conversion would misplace clusters whose
            // members are out-of-range-but-valid (clamped) — e.g. raw X {1050, 649.9} must map
            // to canonical {500, 412.475} → centroid 456.2375, not resolve(mean(raw)).
            final List<MapCoordinateResolution> memberResolutions = clusterIndices.stream()
                    .map(i -> sorted.get(i).getValue())
                    .map(pos -> MapRegionResolver.resolve(pos.x(), pos.z(), mapCode))
                    .filter(MapCoordinateResolution::usable)
                    .toList();
            if (memberResolutions.isEmpty()) continue;
            final float centroidX = (float) memberResolutions.stream()
                    .mapToDouble(res -> res.position().x())
                    .average().orElse(0.0);
            final float centroidZ = (float) memberResolutions.stream()
                    .mapToDouble(res -> res.position().z())
                    .average().orElse(0.0);
            final CanonicalMapPosition canon = new CanonicalMapPosition(centroidX, centroidZ);
            final int region = canon.region();
            final int clampedPosCount = (int) memberResolutions.stream()
                    .filter(res -> res.status() == MapCoordinateResolution.Status.CLAMPED)
                    .count();
            // The centroid inherits CLAMPED whenever it is derived from any clamped member.
            final MapCoordinateResolution.Status centroidStatus = clampedPosCount > 0
                    ? MapCoordinateResolution.Status.CLAMPED
                    : MapCoordinateResolution.Status.VALID;
            final List<String> identities = clusterIndices.stream()
                    .map(i -> sorted.get(i).getKey())
                    .sorted()
                    .toList();
            final DecodeConfidence clusterConfidence = clusterIndices.stream()
                    .map(i -> sorted.get(i).getValue().confidence())
                    .reduce(DecodeConfidence.EXACT, DefaultTeamBattleFeatureExtractor::lowerConfidence);

            result.add(new TeamFormationCluster(
                    startTime, endTime, canon, centroidStatus, region, clampedPosCount, identities, clusterConfidence));
        }

        // Sort by startTime, region, centroidX, centroidZ, then member identities
        result.sort(Comparator.comparingInt(TeamFormationCluster::region)
                .thenComparingDouble(TeamFormationCluster::centroidX)
                .thenComparingDouble(TeamFormationCluster::centroidZ));
        return List.copyOf(result);
    }

    static float distance(
            final float leftX,
            final float leftZ,
            final float rightX,
            final float rightZ
    ) {
        final float deltaX = leftX - rightX;
        final float deltaZ = leftZ - rightZ;
        return (float) Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
    }

    /**
     * Canonical distance in meters for cluster connectivity. Delegates to the single shared
     * {@link MapRegionResolver#canonicalDistanceMeters} helper; unresolvable endpoints map to
     * {@link Float#MAX_VALUE} so they can never join a cluster.
     */
    static float canonicalDistance(
            final float rawX1, final float rawZ1,
            final float rawX2, final float rawZ2,
            final String mapCode
    ) {
        final float meters = MapRegionResolver.canonicalDistanceMeters(rawX1, rawZ1, rawX2, rawZ2, mapCode);
        return meters < 0f ? Float.MAX_VALUE : meters;
    }

    /**
     * Evidence-quality + spatial gate for positions (time is already gated by
     * {@link BattleStartResolution#tryRelative}): confidence must be usable and the coordinate must be within
     * bounds / clampable.
     */
    static boolean usableSpatialEvidence(
            final PositionChangedEvent position,
            final String mapCode
    ) {
        return position.confidence() != DecodeConfidence.UNKNOWN
                && !isOutOfBounds(position, mapCode);
    }

    static boolean isClamped(final PositionChangedEvent position, final String mapCode) {
        return MapRegionResolver.resolve(position.x(), position.z(), mapCode).status()
                == MapCoordinateResolution.Status.CLAMPED;
    }

    static boolean isOutOfBounds(
            final PositionChangedEvent position,
            final String mapCode
    ) {
        if (Math.abs(position.y()) > MAX_ABSOLUTE_ELEVATION) return true;
        return !MapRegionResolver.resolve(position.x(), position.z(), mapCode).usable();
    }

}
