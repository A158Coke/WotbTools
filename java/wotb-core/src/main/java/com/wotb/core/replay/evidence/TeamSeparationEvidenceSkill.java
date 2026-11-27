package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.BattlePhaseType;
import com.wotb.core.replay.feature.TeamBattleFeatureSet;
import com.wotb.core.replay.feature.TeamFormationCluster;
import com.wotb.core.replay.feature.TeamFormationPhase;
import com.wotb.core.replay.feature.TeamMemberFeatureSet;
import com.wotb.core.replay.map.MapTacticalSemantics;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

import static com.wotb.core.replay.evidence.SeparationWindowAnalyzer.SeparationSpan;

public final class TeamSeparationEvidenceSkill {

    public static final float SEPARATION_DISTANCE_M = SeparationThresholds.SEPARATION_DISTANCE_M;
    public static final float STATIONARY_SPEED_MPS = SeparationThresholds.STATIONARY_SPEED_MPS;
    public static final float MIN_MOVEMENT_COVERAGE_RATIO = SeparationThresholds.MIN_MOVEMENT_COVERAGE_RATIO;
    public static final float DISTANCE_GROWTH_M = 20f;
    public static final int MAIN_CLUSTER_DOMINANCE = SeparationWindowAnalyzer.MAIN_CLUSTER_DOMINANCE;
    public static final String OBSERVED_DAMAGE_IS_PARTIAL = "OBSERVED_DAMAGE_IS_PARTIAL";

    private static final int MAX_EVIDENCE = 6;
    private TeamSeparationEvidenceSkill() {
    }

    /**
     * @param features     团队特征（阵型簇/成员移动/交火）
     * @param battle       权威结算（仅作胜负/背景，不用于窗口内获利判定）
     * @param battlePhases 战斗阶段（OPENING 边界/首次接敌；缺失时不出开局分散候选）
     * @param mapSemantics 地图语义（占领点区域；可为 UNKNOWN）
     */
    public static List<AiEvidence> detect(
            final TeamBattleFeatureSet features,
            final Battle battle,
            final List<BattlePhaseSummary> battlePhases,
            final MapTacticalSemantics mapSemantics) {
        if (features == null || features.members() == null || features.members().isEmpty()) {
            return List.of();
        }
        final List<TeamFormationPhase> phases = features.formationPhases() == null
                ? List.of() : new ArrayList<>(features.formationPhases());
        phases.sort(Comparator.comparingDouble(TeamFormationPhase::startTime));
        final OpeningWindow opening = openingWindow(battlePhases);
        final Set<String> controlPointRegions = controlPointRegions(mapSemantics);
        final List<AiEvidence> result = new ArrayList<>();
        int index = 0;
        for (final TeamMemberFeatureSet member : features.members()) {
            final List<SeparationSpan> spans = SeparationWindowAnalyzer.separationSpans(member, phases, features.members());
            for (final SeparationSpan span : spans) {
                final String kind = kindOf(span, opening, member, features);
                if (kind == null) {
                    continue;
                }
                if (index >= MAX_EVIDENCE) {
                    break;
                }
                final Double stationaryRatio = SeparationWindowAnalyzer.stationaryRatio(member, span);
                final int objectiveProximity = objectiveProximity(span.regionInfo().region(),
                        controlPointRegions, mapSemantics);
                final int[] otherActivity = SeparationWindowAnalyzer.otherFriendlyActivity(features.members(), span, member);
                result.add(new AiEvidence(
                        String.format("SS_%02d", ++index),
                        EvidenceType.SPATIAL_SEPARATION,
                        span.startSec(),
                        span.endSec(),
                        List.of(),
                        numbers(member, span, stationaryRatio, objectiveProximity, otherActivity),
                        java.util.Map.of(
                                "kind", kind,
                                "phase", phaseOf(battlePhases, span.startSec()),
                                "movementState", movementState(stationaryRatio),
                                "region", "GRID_REGION_" + span.regionInfo().region()),
                        DecodeConfidence.PARTIAL,
                        EvidencePriority.IMPORTANT,
                        EvidenceProvenance.RECONSTRUCTION_INFERRED,
                        summary(kind, member, span, stationaryRatio, otherActivity)));
            }
        }
        return List.copyOf(result);
    }

    private static java.util.Map<String, Double> numbers(
            final TeamMemberFeatureSet member,
            final SeparationSpan span,
            final Double stationaryRatio,
            final int objectiveProximity,
            final int[] otherActivity) {
        final java.util.Map<String, Double> out = new java.util.HashMap<>();
        out.put("distanceM", (double) span.maxDistanceM());
        out.put("distanceGrowthM", (double) span.distanceGrowthM());
        out.put("stationaryRatio", stationaryRatio == null ? -1.0 : stationaryRatio);
        out.put("mainClusterDisplacementM", (double) span.mainCentroidDisplacementM());
        out.put("observedEnemyNearby", (double) span.enemyPressureCount());
        out.put("damageReceivedDuringSpan", (double) span.damageReceived());
        out.put("damageDealtDuringSpan", (double) span.damageDealt());
        out.put("deathDuringSpan", SeparationWindowAnalyzer.memberDeadIn(member, span) ? 1.0 : 0.0);
        out.put("objectiveProximity", (double) objectiveProximity);
        out.put("otherFriendlyDeathsDuringSpan", (double) otherActivity[0]);
        out.put("otherFriendlyEngagementCountDuringSpan", (double) otherActivity[1]);
        out.put("otherFriendlyDamageDealtDuringSpan", (double) otherActivity[2]);
        out.put("otherFriendlyDamageReceivedDuringSpan", (double) otherActivity[3]);
        return java.util.Collections.unmodifiableMap(out);
    }

    private static String kindOf(
            final SeparationSpan span,
            final OpeningWindow opening,
            final TeamMemberFeatureSet member,
            final TeamBattleFeatureSet features) {
        if (opening != null
                && span.startSec() >= opening.startSec()
                && span.endSec() <= opening.endSec()
                && span.enemyPressureCount() == 0
                && !SeparationWindowAnalyzer.memberDeadIn(member, span)
                && !span.hasPartialOverlapEngagement()
                && !observedDamageIsPartial(features)) {
            return "OPENING_SPREAD";
        }
        if (opening != null && span.startSec() < opening.endSec()) {
            return null;
        }
        if (span.hasPartialOverlapEngagement()) {
            return null;
        }
        return "SEPARATION_WINDOW";
    }

    private static String summary(final String kind, final TeamMemberFeatureSet member,
                                  final SeparationSpan span, final Double stationaryRatio,
                                  final int[] otherActivity) {
        final String stationary = stationaryRatio == null
                ? "移动覆盖不足" : String.format("静止占比 %.0f%%", stationaryRatio * 100);
        return switch (kind) {
            case "OPENING_SPREAD" -> ("开局分散：%s 在开局阶段与主力保持明显距离（与主力相距约 %.0fm）；"
                    + "只反映空间分离结构，是否获得额外敌方信息需结合后续敌方已知状态与接敌情况判断")
                    .formatted(member.nickname(), span.maxDistanceM());
            case "SEPARATION_WINDOW" -> ("空间分离：%s 在 %s 与主要友军集群保持 ≥%.0fm 距离（最大 %.0fm），%s；"
                    + "观察到附近敌军至少 %d 辆，窗口内承伤 %.0f / 输出 %.0f，主力簇位移 %.0fm，"
                    + "其他队友阵亡 %d 辆——战术含义需综合判断")
                    .formatted(member.nickname(), battleRange(span.startSec(), span.endSec()),
                            SEPARATION_DISTANCE_M, span.maxDistanceM(), stationary,
                            span.enemyPressureCount(), span.damageReceived(), span.damageDealt(),
                            span.mainCentroidDisplacementM(), otherActivity[0]);
            default -> "空间分离：%s".formatted(member.nickname());
        };
    }

    private static String battleRange(final float startSec, final float endSec) {
        return battleClock(startSec) + "-" + battleClock(endSec);
    }

    private static String battleClock(final float sec) {
        final int total = (int) Math.max(0, Math.round(sec));
        return (total / 60) + "分" + String.format("%02d", total % 60) + "秒";
    }

    static TeamFormationCluster mainClusterOf(final TeamFormationPhase phase) {
        return SeparationWindowAnalyzer.mainClusterOf(phase);
    }

    static TeamFormationCluster mainClusterOf(final TeamFormationPhase phase,
                                              final int expectedAliveMembers) {
        return SeparationWindowAnalyzer.mainClusterOf(phase, expectedAliveMembers);
    }

    private static boolean observedDamageIsPartial(final TeamBattleFeatureSet features) {
        return features.limitations() != null
                && features.limitations().contains(OBSERVED_DAMAGE_IS_PARTIAL);
    }

    private static OpeningWindow openingWindow(final List<BattlePhaseSummary> battlePhases) {
        if (battlePhases == null || battlePhases.isEmpty()) {
            return null;
        }
        for (final BattlePhaseSummary phase : battlePhases) {
            if (phase.type() == BattlePhaseType.OPENING) {
                return new OpeningWindow(phase.startTime(), phase.endTime());
            }
        }
        return null;
    }

    private static String phaseOf(final List<BattlePhaseSummary> battlePhases, final float sec) {
        if (battlePhases == null) {
            return "UNKNOWN";
        }
        for (final BattlePhaseSummary phase : battlePhases) {
            if (sec >= phase.startTime() && sec <= phase.endTime()) {
                return phase.type().name();
            }
        }
        return "UNKNOWN";
    }

    private static String movementState(final Double stationaryRatio) {
        if (stationaryRatio == null) {
            return "UNKNOWN";
        }
        return stationaryRatio >= 0.6 ? "STATIONARY" : "MOVING";
    }

    public static Set<String> controlPointRegions(final MapTacticalSemantics semantics) {
        final Set<String> regions = new LinkedHashSet<>();
        if (semantics == null || !semantics.hasSemantics()) {
            return regions;
        }
        for (final MapTacticalSemantics.TacticalRelationship relation : semantics.relationships()) {
            if (!"CONTAINS_CONTROL_POINT".equals(relation.type())
                    && !"CONTAINS_STRATEGIC_POINT".equals(relation.type())) {
                continue;
            }
            final MapTacticalSemantics.TacticalArea area = semantics.areas().get(relation.from());
            if (area == null) {
                continue;
            }
            for (final String region : area.gridRegions()) {
                if (region.startsWith("GRID_REGION_")) {
                    regions.add(region.substring("GRID_REGION_".length()));
                }
            }
        }
        return regions;
    }

    private static int objectiveProximity(final int region,
                                          final Set<String> controlPointRegions,
                                          final MapTacticalSemantics semantics) {
        if (region <= 0 || controlPointRegions.isEmpty()) {
            return -1;
        }
        return controlPointRegions.contains(String.valueOf(region)) ? 1 : 0;
    }

    private record OpeningWindow(float startSec, float endSec) {
    }
}
