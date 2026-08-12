package com.wotb.core.replay.evidence;

import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.feature.BattlePhaseType;
import com.wotb.core.replay.feature.EngagementSummary;
import com.wotb.core.replay.feature.MapRegionResolver;
import com.wotb.core.replay.feature.MovementSegment;
import com.wotb.core.replay.feature.MovementType;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.ObservationState;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.VehicleState;
import com.wotb.core.replay.map.MapTacticalSemantics;
import com.wotb.core.replay.map.MapTacticalSemanticsRegistry;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Set;

/**
 * 单走行为候选 Skill（player 路径）：复用 {@link RouteSkill} 脱节窗口，按可观测行为
 * （静止/卡点/守点 + 敌情压力、持续拉大距离 + 被白吃/阵亡）推导「图控 / 拖延 / 脱节」候选。
 * <p>时间口径：接火/承伤/阵亡/距离增长只使用与当前窗口重叠的证据；整场承伤/最终存活不作为
 * 早期窗口依据。未知不等于结论：移动覆盖不足 ≠ MOVING，region/语义缺失 ≠ 远离目标点。</p>
 * <p>开局图控：OPENING 窗口（缺失时回退 45s 安全上限）内未接火/未阵亡；后续掉血/阵亡不抑制
 * 已成立的早期图控。</p>
 */
public final class SoloPlayIntentSkill {

    private static final MapTacticalSemanticsRegistry SEMANTICS = MapTacticalSemanticsRegistry.load();

    private static final int MAX_EVIDENCE = 6;
    /** 移动覆盖门控：窗口内被移动证据覆盖时长占比低于该值时移动状态视为 UNKNOWN。 */
    public static final float MIN_MOVEMENT_COVERAGE_RATIO = 0.5f;

    private SoloPlayIntentSkill() {
    }

    public static List<AiEvidence> detect(final EvidenceSkillContext ctx) {
        final List<AiEvidence> windows = RouteSkill.detachmentWindows(ctx);
        if (windows.isEmpty()) {
            return List.of();
        }
        final PlayerBattleFeatureSet features = ctx.features() == null
                ? PlayerBattleFeatureSet.empty() : ctx.features();
        final float openingEnd = openingEndSec(features);
        final Set<String> controlPointRegions =
                TeamSoloIntentSkill.controlPointRegions(SEMANTICS.semanticsFor(ctx.battle().mapName));
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
            final String intent = classify(window, stationaryRatio, inWindowDamage,
                    inWindowDealt, distanceGrowth, openingEnd, recorder,
                    hasPartialOverlapEngagement(features, window.startSec(), window.endSec()));
            if (intent == null) {
                continue;
            }
            final float distanceM = window.numbers().getOrDefault("distanceM", 150.0)
                    .floatValue();
            final int objectiveProximity = objectiveProximity(region, controlPointRegions);
            final boolean contactObserved = inWindowDealt > 0f || inWindowDamage > 0f;
            final boolean underPressure = inWindowDamage > 0f;
            result.add(new AiEvidence(
                    String.format("SI_%02d", ++index),
                    EvidenceType.SOLO_INTENT,
                    window.startSec(),
                    window.endSec(),
                    List.of(),
                    java.util.Map.of(
                            "distanceM", (double) distanceM,
                            "distanceGrowthM", distanceGrowth == null ? -1.0 : distanceGrowth,
                            "stationaryRatio", stationaryRatio == null ? -1.0 : stationaryRatio,
                            "objectiveProximity", (double) objectiveProximity,
                            "contactObserved", contactObserved ? 1.0 : 0.0,
                            "underPressure", underPressure ? 1.0 : 0.0),
                    java.util.Map.of(
                            "intent", intent,
                            "region", region == null ? "GRID_REGION_UNKNOWN"
                                    : "GRID_REGION_" + region),
                    DecodeConfidence.PARTIAL,
                    EvidencePriority.IMPORTANT,
                    EvidenceProvenance.RECONSTRUCTION_INFERRED,
                    summary(intent, window, recorder)));
        }
        return List.copyOf(result);
    }

    private static String classify(
            final AiEvidence window,
            final Double stationaryRatio,
            final float inWindowDamage,
            final float inWindowDealt,
            final Float distanceGrowth,
            final float openingEnd,
            final PlayerResult recorder,
            final boolean partialOverlap
    ) {
        final boolean opening = window.startSec() >= 0f && window.endSec() <= openingEnd;
        final boolean contactObserved = inWindowDealt > 0f || inWindowDamage > 0f;
        final boolean underPressure = inWindowDamage > 0f;
        final boolean untouchedInWindow = !contactObserved && !memberDeadIn(recorder, window);
        if (opening && untouchedInWindow && !partialOverlap) {
            return "OPENING_MAP_CONTROL";
        }
        if (window.startSec() < openingEnd) {
            return null;
        }
        // 未知（null）不等于 MOVING / STATIONARY：只有覆盖充分时才判移动状态
        final boolean stationary = stationaryRatio != null
                && stationaryRatio >= TeamSoloIntentSkill.MIN_STATIONARY_SHARE;
        if (stationary && underPressure) {
            return "SOLO_DELAY";
        }
        final boolean moving = stationaryRatio != null
                && stationaryRatio < TeamSoloIntentSkill.MIN_STATIONARY_SHARE;
        final boolean pulledAway = distanceGrowth != null
                && distanceGrowth >= TeamSoloIntentSkill.DISTANCE_GROWTH_M;
        final boolean whiteEaten = memberDeadIn(recorder, window)
                || inWindowDamage >= TeamSoloIntentSkill.DETACH_DAMAGE_RECEIVED;
        if (moving && pulledAway && whiteEaten) {
            return "SOLO_DETACHED";
        }
        return null;
    }

    private static boolean memberDeadIn(final PlayerResult recorder, final AiEvidence window) {
        if (recorder == null) {
            return false;
        }
        final double deathSec = recorder.deathTimeMillis > 0
                ? recorder.deathTimeMillis / 1000.0 : -1.0;
        return !recorder.survived && deathSec >= 0
                && deathSec >= window.startSec() && deathSec <= window.endSec();
    }

    private static String summary(final String intent, final AiEvidence window,
                                  final PlayerResult recorder) {
        final String who = recorder == null || recorder.nickname == null
                ? "录像者" : recorder.nickname;
        return switch (intent) {
            case "OPENING_MAP_CONTROL" -> "开局图控：%s 开局散开拿视野（%.0fs）"
                    .formatted(who, window.endSec() - window.startSec());
            case "SOLO_DELAY" -> "单走拖延：%s 静止卡点/守点且有敌情压力（约 %.0fs）"
                    .formatted(who, window.endSec() - window.startSec());
            case "SOLO_DETACHED" -> "单走脱节：%s 持续脱离队友且无掩护（约 %.0fs）"
                    .formatted(who, window.endSec() - window.startSec());
            default -> "单走：%s".formatted(who);
        };
    }

    private static float openingEndSec(final PlayerBattleFeatureSet features) {
        if (features.phases() != null) {
            for (final BattlePhaseSummary phase : features.phases()) {
                if (phase.type() == BattlePhaseType.OPENING) {
                    return phase.endTime();
                }
            }
        }
        // 阶段缺失时使用明确的 45s 安全回退（与 RouteSkill.OPENING_END_SEC 一致）
        return RouteSkill.OPENING_END_SEC;
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
                    || segment.averageSpeed() < TeamSoloIntentSkill.STATIONARY_SPEED_MPS) {
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

    /** 是否存在与窗口相交但不完全包含的交火：无法可靠归属，禁止据此下结论。 */
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

    /** 窗口内距离增长：由 checkpoints 的录像者-友军质心距离序列首尾差得出；不足 2 点返回 null。 */
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

    /** 目标点关系三态：1=邻近 / 0=已知不在 / -1=未知（region 缺失或无语义，不等于远离）。 */
    private static int objectiveProximity(final Integer region, final Set<String> controlPointRegions) {
        if (region == null || controlPointRegions.isEmpty()) {
            return -1;
        }
        return controlPointRegions.contains(String.valueOf(region)) ? 1 : 0;
    }
}
