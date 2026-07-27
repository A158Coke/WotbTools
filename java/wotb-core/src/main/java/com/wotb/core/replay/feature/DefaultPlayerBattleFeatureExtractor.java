package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.Vector3;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 默认录像者个人特征提取器。
 * 只处理 recorder entity 的位置和伤害事件。
 */
public class DefaultPlayerBattleFeatureExtractor implements PlayerBattleFeatureExtractor {

    static final int ENGAGEMENT_GAP_SEC = 15;
    /**
     * Stationary threshold in <strong>canonical meters</strong> (500×500 map). Centrally
     * defined here and shared by both PLAYER_FOCUSED movement and TEAM_PERSPECTIVE member
     * movement (Team reuses {@link #compressMovements}), so both use identical units.
     */
    static final float STATIONARY_THRESHOLD_METERS = 3f;
    static final int MAX_KEY_EVENTS = 40;

    @Override
    public PlayerBattleFeatureSet extract(final ReplayReconstruction reconstruction, final RecorderEntityMapping recorder) {
        if (recorder == null || !recorder.resolved() || reconstruction == null) {
            return PlayerBattleFeatureSet.empty();
        }

        final int recorderEid = recorder.entityId();
        final List<ReplayEvent> events = reconstruction.events();

        // 确定战斗开始时间（用于过滤准备阶段数据）
        final BattleStartResolution battleStartRes = BattleStartResolver.resolve(
                reconstruction.battleStartRawClockSec(),
                reconstruction.diagnostics());

        // 过滤 recorder 的位置事件（排除准备阶段）
        final List<PositionChangedEvent> positions = new ArrayList<>();
        final List<DamageEvent> damages = new ArrayList<>();
        // 记录首次伤害时间用于阶段划分
        float firstContactTime = -1f;
        float battleEndClock = Float.NaN;

        for (final ReplayEvent event : events) {
            switch (event) {
                case PositionChangedEvent p -> {
                    if (p.entityId() == recorderEid) {
                        if (p.timestamp() == null || !Float.isFinite(p.timestamp().rawClockSec())) {
                            continue;
                        }
                        if (battleStartRes.isPreBattle(
                                p.timestamp().rawClockSec())) {
                            continue;
                        }
                        positions.add(p);
                    }
                }
                case DamageEvent d -> {
                    if (d.timestamp() == null || !Float.isFinite(d.timestamp().rawClockSec())) {
                        continue;
                    }
                    if (battleStartRes.isPreBattle(
                            d.timestamp().rawClockSec())) {
                        continue;
                    }
                    // 只有当 recorder 是攻击者或受害者时才记录
                    final boolean recorderIsAttacker = d.attackerEid() == recorderEid;
                    final boolean recorderIsVictim = d.victimEid() == recorderEid;
                    if (recorderIsAttacker || recorderIsVictim) {
                        damages.add(d);
                    if (firstContactTime < 0) {
                            firstContactTime = ReplayTimestamp.safeClockSec(d.timestamp());
                            firstContactTime = battleStartRes.battleRelative(firstContactTime);
                        }
                    }
                }
                case com.wotb.core.replay.event.BattleEndedEvent b -> {
                    if (Float.isNaN(battleEndClock)) {
                        if (b.timestamp() != null && Float.isFinite(b.timestamp().rawClockSec())) {
                            battleEndClock = battleStartRes.battleRelative(
                                    b.timestamp().rawClockSec());
                        }
                    }
                }
                default -> {}
            }
        }

        // 压缩移动段（只针对 recorder，使用 battle-relative 时间）
        final List<MovementSegment> movements = compressMovements(positions, battleStartRes);

        // 交火段
        final List<EngagementSummary> engagements = buildEngagements(damages, recorder.entityId(), battleStartRes);

        // Phases (battle-relative)
        final List<BattlePhaseSummary> phases = DefaultBattleFeatureExtractor.buildRelativePhases(
                        firstContactTime, battleEndClock);

        // 关键事件
        final List<KeyBattleEvent> keyEvents = extractRecorderKeyEvents(damages, recorder, battleStartRes);

        final boolean hasRealFeatures = !movements.isEmpty()
                || !engagements.isEmpty()
                || !keyEvents.isEmpty();
        final List<String> limitations = new ArrayList<>();
        if (battleStartRes.limitation() != null) {
            limitations.add(battleStartRes.limitation());
        }
        if (!hasRealFeatures) {
            limitations.add("Recorder entity has no position or damage events in event stream");
        }
        if (recorder.confidence() != DecodeConfidence.EXACT) {
            limitations.add("Recorder entity mapping confidence: " + recorder.confidence()
                    + " — entity ID may be unreliable");
        }

        return new PlayerBattleFeatureSet(movements, engagements, phases, keyEvents,
                limitations, hasRealFeatures);
    }

    static List<MovementSegment> compressMovements(final List<PositionChangedEvent> positions,
                                                    final BattleStartResolution battleStartRes) {
        // Keep only positions with a usable clock and a resolvable canonical coordinate.
        // INVALID positions (non-finite / beyond clamp tolerance) and invalid-timestamp
        // positions are unusable movement evidence and must not create fake distance/speed.
        final List<PositionChangedEvent> usable = positions.stream()
                .filter(DefaultPlayerBattleFeatureExtractor::hasUsableClock)
                .filter(p -> MapRegionResolver.resolve(p.x(), p.z()).usable())
                .toList();
        if (usable.isEmpty()) return List.of();
        if (usable.size() == 1) {
            final PositionChangedEvent only = usable.get(0);
            final float t = battleStartRes.battleRelative(only.timestamp().rawClockSec());
            final Vector3 pos = new Vector3(only.x(), only.y(), only.z());
            return List.of(new MovementSegment(t, t,
                    MovementType.STATIONARY, pos, pos,
                    0f, 0f, positionConfidence(usable.subList(0, 1))));
        }

        final List<MovementSegment> result = new ArrayList<>();
        int start = 0;
        for (int i = 1; i < usable.size(); i++) {
            // Distance in canonical meters (each endpoint resolved/clamped to canonical first).
            final float totalDist = MapRegionResolver.canonicalDistanceMeters(
                    usable.get(start).x(), usable.get(start).z(),
                    usable.get(i).x(), usable.get(i).z());
            final float segmentTime = ReplayTimestamp.safeClockSec(usable.get(i).timestamp())
                    - ReplayTimestamp.safeClockSec(usable.get(start).timestamp());

            // Non-positive / reversed / zero time delta must not produce Infinity/NaN speed.
            if (segmentTime <= 0.1f) continue;

            final boolean stationary = totalDist < STATIONARY_THRESHOLD_METERS;
            if (i < usable.size() - 1) {
                // 检查下一段是否同类型（canonical meters）
                final float nextDist = MapRegionResolver.canonicalDistanceMeters(
                        usable.get(i).x(), usable.get(i).z(),
                        usable.get(i + 1).x(), usable.get(i + 1).z());
                final boolean nextStationary = nextDist < STATIONARY_THRESHOLD_METERS;
                if (stationary == nextStationary && i - start > 1) continue;
            }

            result.add(new MovementSegment(
                    battleStartRes.battleRelative(usable.get(start).timestamp().rawClockSec()),
                    battleStartRes.battleRelative(usable.get(i).timestamp().rawClockSec()),
                    stationary ? MovementType.STATIONARY : MovementType.MOVING,
                    new Vector3(usable.get(start).x(), usable.get(start).y(), usable.get(start).z()),
                    new Vector3(usable.get(i).x(), usable.get(i).y(), usable.get(i).z()),
                    totalDist, totalDist / segmentTime,
                    positionConfidence(usable.subList(start, i + 1))));
            start = i;
        }
        return result;
    }

    private static boolean hasUsableClock(final PositionChangedEvent position) {
        if (position == null || position.timestamp() == null) {
            return false;
        }
        return Float.isFinite(ReplayTimestamp.safeClockSec(position.timestamp()));
    }

    private static DecodeConfidence positionConfidence(
            final List<PositionChangedEvent> positions
    ) {
        return positions.stream()
                .map(PositionChangedEvent::confidence)
                .map(confidence -> confidence == null
                        ? DecodeConfidence.UNKNOWN : confidence)
                .min(Comparator.comparingInt(
                        DefaultPlayerBattleFeatureExtractor::confidenceRank))
                .orElse(DecodeConfidence.UNKNOWN);
    }

    private static int confidenceRank(final DecodeConfidence confidence) {
        return switch (confidence) {
            case UNKNOWN -> 0;
            case PARTIAL -> 1;
            case INFERRED -> 2;
            case EXACT -> 3;
        };
    }

    static List<EngagementSummary> buildEngagements(final List<DamageEvent> damages, final int recorderEid,
                                                     final BattleStartResolution battleStartRes) {
        if (damages.isEmpty()) return List.of();
        final List<DamageEvent> sorted = damages.stream()
                .sorted(Comparator.comparingDouble(d -> ReplayTimestamp.safeClockSec(d.timestamp())))
                .toList();
        final List<EngagementSummary> result = new ArrayList<>();
        int segStart = 0;
        for (int i = 1; i < sorted.size(); i++) {
            if (ReplayTimestamp.safeClockSec(sorted.get(i).timestamp()) - ReplayTimestamp.safeClockSec(sorted.get(i - 1).timestamp()) > ENGAGEMENT_GAP_SEC) {
                result.add(buildEngagementSegment(sorted.subList(segStart, i), recorderEid, battleStartRes));
                segStart = i;
            }
        }
        if (segStart < sorted.size()) {
            result.add(buildEngagementSegment(sorted.subList(segStart, sorted.size()), recorderEid, battleStartRes));
        }
        return result;
    }

    private static EngagementSummary buildEngagementSegment(final List<DamageEvent> events, final int recorderEid,
                                                             final BattleStartResolution battleStartRes) {
        int dealt = 0, received = 0;
        for (final DamageEvent d : events) {
            if (d.attackerEid() == recorderEid) dealt += d.damage();
            if (d.victimEid() == recorderEid) received += d.damage();
        }
        final EngagementOutcome outcome = (dealt > received * 1.25)
                ? EngagementOutcome.FAVORABLE
                : (received > dealt * 1.25)
                ? EngagementOutcome.UNFAVORABLE
                : EngagementOutcome.EVEN;

        return new EngagementSummary(
                battleStartRes.battleRelative(events.getFirst().timestamp().rawClockSec()),
                battleStartRes.battleRelative(events.getLast().timestamp().rawClockSec()),
                List.of(), List.of(), dealt, received,
                null, null, outcome, com.wotb.core.replay.event.DecodeConfidence.INFERRED);
    }

    static List<KeyBattleEvent> extractRecorderKeyEvents(
            final List<DamageEvent> damages, final RecorderEntityMapping recorder,
            final BattleStartResolution battleStartRes) {
        final List<KeyBattleEvent> keyEvents = new ArrayList<>();
        boolean firstBlood = false;
        int totalEvents = 0;

        for (final DamageEvent d : damages) {
            if (totalEvents >= MAX_KEY_EVENTS) break;
            if (!firstBlood) {
                firstBlood = true;
                keyEvents.add(new KeyBattleEvent(battleStartRes.battleRelative(d.timestamp().rawClockSec()), "RECORDER_FIRST_BLOOD",
                        "首次命中 " + d.damage()));
            } else {
                keyEvents.add(new KeyBattleEvent(battleStartRes.battleRelative(d.timestamp().rawClockSec()),
                        d.attackerEid() == recorder.entityId() ? "RECORDER_DAMAGE_DEALT" : "RECORDER_DAMAGE_RECEIVED",
                        "录像者 " + d.damage()));
            }
            totalEvents++;
        }
        return keyEvents;
    }
}
