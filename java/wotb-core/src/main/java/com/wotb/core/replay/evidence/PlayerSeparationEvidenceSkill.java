package com.wotb.core.replay.evidence;

import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.BattlePhaseType;
import com.wotb.core.replay.feature.EngagementSummary;
import com.wotb.core.replay.feature.MapRegionResolver;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.MovementType;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.map.MapTacticalSemanticsRegistry;
import com.wotb.core.replay.processing.RecorderEntityMapping;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.ObservationState;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.VehicleState;
import com.wotb.core.util.PlayerResultFormat;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 空间分离证据 Skill（player 路径，Backend Evidence Boundary）。
 * <p>复用 {@link RouteSkill} 分离窗口，只输出【确定性派生证据】：录像者与主要友军集群保持
 * 空间分离的结构事实（距离、距离增长、静止占比、移动覆盖、窗口内输出/承伤、阵亡、局部敌情、
 * 目标点邻近关系）。<b>不输出任何战术判断</b>——「拖延 / 脱节 / 有效牵制 / 图控 / 拿视野」都是
 * LLM 基于这些事实做出的 supported tactical inference，不是 Backend label。</p>
 * <p>时间口径：接火/承伤/阵亡/距离增长只使用与当前窗口重叠的证据；整场承伤/最终存活不作为
 * 早期窗口依据。未知不等于结论：移动覆盖不足 ≠ MOVING，region/语义缺失 ≠ 远离目标点；
 * 阵亡时间只消费 Battle 上的显式 live/settlement observation，UNKNOWN 不得伪装为 0 秒。</p>
 * <p>开局分散（中性 signal）：OPENING 窗口（缺失时回退 45s 安全上限）内未接火/未阵亡；
 * 只证明位置/队形分离，不证明拿视野/点亮/侦察；后续掉血/阵亡不抑制已成立的早期分散。</p>
 */
public final class PlayerSeparationEvidenceSkill {

    private static final MapTacticalSemanticsRegistry SEMANTICS = MapTacticalSemanticsRegistry.load();

    private static final int MAX_EVIDENCE = 6;
    /** 移动覆盖门控：窗口内被移动证据覆盖时长占比低于该值时移动状态视为 UNKNOWN。 */
    public static final float MIN_MOVEMENT_COVERAGE_RATIO = 0.5f;

    private PlayerSeparationEvidenceSkill() {
    }

    public static List<AiEvidence> detect(final EvidenceSkillContext ctx) {
        final List<AiEvidence> windows = RouteSkill.separationWindows(ctx);
        if (windows.isEmpty()) {
            return List.of();
        }
        final PlayerBattleFeatureSet features = ctx.features() == null
                ? PlayerBattleFeatureSet.empty() : ctx.features();
        final float openingEnd = openingEndSec(features);
        final Set<String> controlPointRegions =
                TeamSeparationEvidenceSkill.controlPointRegions(SEMANTICS.semanticsFor(ctx.battle().mapName));
        final PlayerResult recorder = ctx.battle().recorderResult();
        final List<AiEvidence> result = new ArrayList<>();
        int index = 0;
        for (final AiEvidence window : windows) {
            if (index >= MAX_EVIDENCE) {
                break;
            }
            final Double stationaryRatio = stationaryRatio(features, window.startSec(), window.endSec());
            final float inWindowDealt = engagementDamageDealt(features, window.startSec(), window.endSec());
            final float inWindowDamage = engagementDamage(features, window.startSec(), window.endSec());
            final Float distanceGrowth = distanceGrowthMeters(ctx, window.startSec(), window.endSec());
            final Integer region = recorderRegion(
                    features, window.startSec(), window.endSec(), ctx.battle().mapName);
            final String kind = kindOf(ctx.battle(), window, stationaryRatio, inWindowDamage,
                    inWindowDealt, openingEnd, recorder,
                    hasPartialOverlapEngagement(features, window.startSec(), window.endSec()),
                    observedDamageIsPartial(features));
            if (kind == null) {
                continue;
            }
            final float distanceM = window.numbers().getOrDefault("distanceM", 150.0)
                    .floatValue();
            final int objectiveProximity = objectiveProximity(region, controlPointRegions);
            final java.util.Map<String, Double> numbers = java.util.Map.of(
                    "distanceM", (double) distanceM,
                    "distanceGrowthM", distanceGrowth == null ? -1.0 : distanceGrowth,
                    "stationaryRatio", stationaryRatio == null ? -1.0 : stationaryRatio,
                    "objectiveProximity", (double) objectiveProximity,
                    "damageDealtDuringSpan", (double) inWindowDealt,
                    "damageReceivedDuringSpan", (double) inWindowDamage,
                    "deathDuringSpan", memberDeadIn(ctx.battle(), recorder, window) ? 1.0 : 0.0);
            result.add(new AiEvidence(
                    String.format("SS_%02d", ++index),
                    EvidenceType.SPATIAL_SEPARATION,
                    window.startSec(),
                    window.endSec(),
                    List.of(),
                    numbers,
                    java.util.Map.of(
                            "kind", kind,
                            "phase", phaseOf(features.phases(), window.startSec()),
                            "movementState", movementState(stationaryRatio),
                            "region", region == null ? "GRID_REGION_UNKNOWN"
                                    : "GRID_REGION_" + region),
                    DecodeConfidence.PARTIAL,
                    EvidencePriority.IMPORTANT,
                    EvidenceProvenance.RECONSTRUCTION_INFERRED,
                    summary(kind, window, recorder, stationaryRatio, numbers)));
        }
        return List.copyOf(result);
    }

    private static String kindOf(
            final com.wotb.core.model.Battle battle,
            final AiEvidence window,
            final Double stationaryRatio,
            final float inWindowDamage,
            final float inWindowDealt,
            final float openingEnd,
            final PlayerResult recorder,
            final boolean partialOverlap,
            final boolean damageCoveragePartial
    ) {
        final boolean opening = window.startSec() >= 0f && window.endSec() <= openingEnd;
        final boolean contactObserved = inWindowDealt > 0f || inWindowDamage > 0f;
        final boolean untouchedInWindow = !contactObserved
                && !memberDeadIn(battle, recorder, window);
        if (opening && untouchedInWindow && !partialOverlap && !damageCoveragePartial) {
            return "OPENING_SPREAD";
        }
        if (window.startSec() < openingEnd) {
            return null;
        }
        if (partialOverlap) {
            return null;
        }
        return "SEPARATION_WINDOW";
    }

    private static boolean memberDeadIn(final com.wotb.core.model.Battle battle,
                                        final PlayerResult recorder, final AiEvidence window) {
        if (recorder == null || recorder.survived) {
            return false;
        }
        final double deathSec = PlayerResultFormat.deathSec(recorder);
        return deathSec > 0 && Double.isFinite(deathSec)
                && deathSec >= window.startSec() && deathSec <= window.endSec();
    }

    private static String summary(final String kind, final AiEvidence window,
                                  final PlayerResult recorder, final Double stationaryRatio,
                                  final Map<String, Double> numbers) {
        final String who = recorder == null || recorder.nickname == null
                ? "录像者" : recorder.nickname;
        final String stationary = stationaryRatio == null
                ? "移动覆盖不足" : String.format("静止占比 %.0f%%", stationaryRatio * 100);
        final double dealt = numbers.getOrDefault("damageDealtDuringSpan", 0.0);
        final double received = numbers.getOrDefault("damageReceivedDuringSpan", 0.0);
        return switch (kind) {
            case "OPENING_SPREAD" -> ("开局分散：%s 开局与主力拉开（%.0fs）；"
                    + "只反映空间分离结构，是否获得额外敌方信息需专门的 visibility evidence 确认")
                    .formatted(who, window.endSec() - window.startSec());
            case "SEPARATION_WINDOW" -> ("空间分离：%s 在 %s 与主要友军集群保持 ≥%.0fm 距离，%s；"
                    + "窗口内输出 %.0f / 承伤 %.0f——战术含义需综合判断")
                    .formatted(who, battleRange(window.startSec(), window.endSec()),
                            RouteSkill.SEPARATION_RADIUS_M, stationary,
                            dealt, received);
            default -> "空间分离：%s".formatted(who);
        };
    }

    private static String battleRange(final float startSec, final float endSec) {
        return battleClock(startSec) + "-" + battleClock(endSec);
    }

    private static String battleClock(final float sec) {
        final int total = (int) Math.max(0, Math.round(sec));
        return (total / 60) + "分" + String.format("%02d", total % 60) + "秒";
    }

    private static float openingEndSec(final PlayerBattleFeatureSet features) {
        if (features.phases() != null) {
            for (final BattlePhaseSummary phase : features.phases()) {
                if (phase.type() == BattlePhaseType.OPENING) {
                    return phase.endTime();
                }
            }
        }
        return RouteSkill.OPENING_END_SEC;
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

    private static Double stationaryRatio(final PlayerBattleFeatureSet features,
                                          final float start, final float end) {
        float covered = 0f;
        float stationary = 0f;
        for (final MovementSegment segment : features.movements()) {
            final float overlapStart = Math.max(segment.startTime(), start);
            final float overlapEnd = Math.min(segment.endTime(), end);
            if (overlapEnd <= overlapStart) {
                continue;
            }
            final float duration = overlapEnd - overlapStart;
            covered += duration;
            if (segment.type() == MovementType.STATIONARY
                    || segment.averageSpeed() < TeamSeparationEvidenceSkill.STATIONARY_SPEED_MPS) {
                stationary += duration;
            }
        }
        final float spanDuration = end - start;
        if (covered <= 0f || spanDuration <= 0f
                || covered / spanDuration < MIN_MOVEMENT_COVERAGE_RATIO) {
            return null;
        }
        return (double) stationary / covered;
    }

    private static float engagementDamageDealt(final PlayerBattleFeatureSet features,
                                               final float start, final float end) {
        float damage = 0f;
        for (final EngagementSummary engagement : features.engagements()) {
            if (fullyContained(engagement, start, end)) {
                damage += engagement.damageDealt();
            }
        }
        return damage;
    }

    private static float engagementDamage(final PlayerBattleFeatureSet features,
                                          final float start, final float end) {
        float damage = 0f;
        for (final EngagementSummary engagement : features.engagements()) {
            if (fullyContained(engagement, start, end)) {
                damage += engagement.damageReceived();
            }
        }
        return damage;
    }

    private static boolean hasPartialOverlapEngagement(final PlayerBattleFeatureSet features,
                                                       final float start, final float end) {
        for (final EngagementSummary engagement : features.engagements()) {
            if (engagement.startTime() <= end && engagement.endTime() >= start
                    && !fullyContained(engagement, start, end)) {
                return true;
            }
        }
        return false;
    }

    private static boolean fullyContained(final EngagementSummary engagement,
                                          final float start, final float end) {
        return engagement.startTime() >= start - 0.01f
                && engagement.endTime() <= end + 0.01f;
    }

    private static boolean observedDamageIsPartial(final PlayerBattleFeatureSet features) {
        return features.limitations() != null
                && features.limitations().contains(TeamSeparationEvidenceSkill.OBSERVED_DAMAGE_IS_PARTIAL);
    }

    private static Float distanceGrowthMeters(final EvidenceSkillContext ctx,
                                              final float start, final float end) {
        final ReplayReconstruction recon = ctx.recon();
        final RecorderEntityMapping recorder = ctx.recorder();
        if (recon == null || recon.checkpoints() == null || recon.checkpoints().isEmpty()
                || recorder == null || recorder.entityId() == null
                || recorder.team() == null || recon.battleStartRawClockSec() == null) {
            return null;
        }
        final List<BattleStateCheckpoint> sorted = new ArrayList<>(recon.checkpoints());
        sorted.sort(Comparator.comparingDouble(BattleStateCheckpoint::rawClockSec));
        final float startRaw = recon.battleStartRawClockSec();
        final List<Float> distances = new ArrayList<>();
        for (final BattleStateCheckpoint checkpoint : sorted) {
            final float rel = checkpoint.rawClockSec() - startRaw;
            if (rel < start || rel > end) {
                continue;
            }
            final VehicleState recorderVehicle = checkpoint.stateSnapshot()
                    .vehicleByEntityId(recorder.entityId());
            if (recorderVehicle == null || recorderVehicle.position() == null
                    || recorderVehicle.observationState() != ObservationState.OBSERVED) {
                continue;
            }
            final float[] centroid = friendlyCentroid(checkpoint, recorder.entityId(), recorder.team());
            if (centroid == null) {
                continue;
            }
            final float meters = MapRegionResolver.canonicalDistanceMeters(
                    recorderVehicle.position().x(), recorderVehicle.position().z(),
                    centroid[0], centroid[1], ctx.battle().mapName);
            if (meters >= 0f) {
                distances.add(meters);
            }
        }
        if (distances.size() < 2) {
            return null;
        }
        return distances.getLast() - distances.getFirst();
    }

    private static float[] friendlyCentroid(final BattleStateCheckpoint checkpoint,
                                            final int recorderEntityId, final int recorderTeam) {
        float sumX = 0;
        float sumZ = 0;
        int count = 0;
        for (final VehicleState vehicle : checkpoint.stateSnapshot().vehiclesByEntityId().values()) {
            if (vehicle.entityId() == recorderEntityId || vehicle.position() == null
                    || vehicle.observationState() != ObservationState.OBSERVED) {
                continue;
            }
            final Integer team = vehicle.team();
            if (team == null || team != recorderTeam) {
                continue;
            }
            sumX += vehicle.position().x();
            sumZ += vehicle.position().z();
            count++;
        }
        return count == 0 ? null : new float[]{sumX / count, sumZ / count};
    }

    private static Integer recorderRegion(final PlayerBattleFeatureSet features,
                                          final float start, final float end,
                                          final String mapCode) {
        MovementSegment last = null;
        for (final MovementSegment segment : features.movements()) {
            if (segment.startTime() <= end && segment.endTime() >= start) {
                last = segment;
            }
        }
        if (last == null) {
            return null;
        }
        final int region = MapRegionResolver.resolveRegionFromRaw(
                last.rawEndPosition().x(), last.rawEndPosition().z(), mapCode);
        return region > 0 ? region : null;
    }

    private static int objectiveProximity(final Integer region, final Set<String> controlPointRegions) {
        if (region == null || controlPointRegions.isEmpty()) {
            return -1;
        }
        return controlPointRegions.contains(String.valueOf(region)) ? 1 : 0;
    }
}
