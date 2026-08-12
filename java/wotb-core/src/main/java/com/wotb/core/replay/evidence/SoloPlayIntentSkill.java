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
import com.wotb.core.replay.map.MapTacticalSemantics;
import com.wotb.core.replay.map.MapTacticalSemanticsRegistry;

import java.util.ArrayList;
import java.util.List;
import java.util.Set;

/**
 * 单走行为候选 Skill（player 路径）：复用 {@link RouteSkill} 脱节窗口，按可观测行为
 * （静止/卡点/守点 + 敌情压力、持续拉大距离 + 被白吃/阵亡）推导「图控 / 拖延 / 脱节」候选。
 * <p>与 {@link TeamSoloIntentSkill} 同口径：开局图控抑制脱节；只输出 PARTIAL 规则候选，
 * 证据不足/矛盾不输出（prompt 规则要求 AI 写「无法确定」）。个人复盘无「队友获利」维度。</p>
 */
public final class SoloPlayIntentSkill {

    private static final MapTacticalSemanticsRegistry SEMANTICS = MapTacticalSemanticsRegistry.load();

    private static final int MAX_EVIDENCE = 6;

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
            final int pressure = engagementCount(features, window.startSec(), window.endSec());
            final Integer region = recorderRegion(
                    features, window.startSec(), window.endSec(), ctx.battle().mapName);
            final String intent = classify(window, stationaryRatio, pressure,
                    region, controlPointRegions, openingEnd, recorder);
            if (intent == null) {
                continue;
            }
            final float distanceM = window.numbers().getOrDefault("distanceM", 150.0)
                    .floatValue();
            result.add(new AiEvidence(
                    String.format("SI_%02d", ++index),
                    EvidenceType.SOLO_INTENT,
                    window.startSec(),
                    window.endSec(),
                    List.of(),
                    java.util.Map.of(
                            "distanceM", (double) distanceM,
                            "stationaryRatio", stationaryRatio == null ? -1.0 : stationaryRatio,
                            "objectiveProximity", region != null
                                    && controlPointRegions.contains(String.valueOf(region)) ? 1.0 : 0.0,
                            "nearbyEnemy", (double) pressure),
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
            final int pressure,
            final Integer region,
            final Set<String> controlPointRegions,
            final float openingEnd,
            final PlayerResult recorder
    ) {
        final boolean opening = window.startSec() >= 0f && window.endSec() <= openingEnd;
        final boolean untouched = recorder == null
                || (recorder.damageReceived == 0 && recorder.survived);
        if (opening && untouched) {
            return "OPENING_MAP_CONTROL";
        }
        if (window.startSec() < openingEnd) {
            return null;
        }
        final boolean stationary = stationaryRatio != null
                && stationaryRatio >= TeamSoloIntentSkill.MIN_STATIONARY_SHARE;
        if (stationary && pressure > 0) {
            return "SOLO_DELAY";
        }
        final boolean moving = stationaryRatio == null
                || stationaryRatio < TeamSoloIntentSkill.MIN_STATIONARY_SHARE;
        final boolean whiteEaten = recorder != null
                && (recorder.damageReceived >= TeamSoloIntentSkill.DETACH_DAMAGE_RECEIVED
                || !recorder.survived);
        final boolean noObjective = region == null
                || !controlPointRegions.contains(String.valueOf(region));
        if (moving && noObjective && whiteEaten) {
            return "SOLO_DETACHED";
        }
        return null;
    }

    private static String summary(final String intent, final AiEvidence window,
                                  final PlayerResult recorder) {
        final String who = recorder == null || recorder.nickname == null
                ? "录像者" : recorder.nickname;
        return switch (intent) {
            case "OPENING_MAP_CONTROL" -> "开局图控：%s 开局散开拿视野（%.0fs）"
                    .formatted(who, window.endSec() - window.startSec());
            case "SOLO_DELAY" -> "单走拖延候选：%s 静止卡点/守点且有敌情压力（%.0fs）"
                    .formatted(who, window.endSec() - window.startSec());
            case "SOLO_DETACHED" -> "单走脱节候选：%s 持续拉大距离且无掩护（%.0fs）"
                    .formatted(who, window.endSec() - window.startSec());
            default -> "单走候选：%s".formatted(who);
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
        if (covered <= 0f) {
            return null;
        }
        return (double) stationary / covered;
    }

    private static int engagementCount(final PlayerBattleFeatureSet features,
                                       final float start, final float end) {
        int count = 0;
        for (final EngagementSummary engagement : features.engagements()) {
            if (engagement.startTime() <= end && engagement.endTime() >= start) {
                count += engagement.enemyAccountIds().size();
            }
        }
        return count;
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
}
