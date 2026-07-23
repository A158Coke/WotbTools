package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DamageEvent;
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
    static final float STATIONARY_THRESHOLD = 3f;
    static final int MAX_KEY_EVENTS = 40;

    @Override
    public PlayerBattleFeatureSet extract(ReplayReconstruction reconstruction, RecorderEntityMapping recorder) {
        if (recorder == null || !recorder.resolved()) {
            return PlayerBattleFeatureSet.empty();
        }

        final int recorderEid = recorder.entityId();
        final List<ReplayEvent> events = reconstruction.events();

        // 过滤 recorder 的位置事件
        final List<PositionChangedEvent> positions = new ArrayList<>();
        final List<DamageEvent> damages = new ArrayList<>();
        // 记录首次伤害时间用于阶段划分
        float firstContactTime = -1f;
        float battleEndClock = Float.NaN;

        for (final ReplayEvent event : events) {
            switch (event) {
                case PositionChangedEvent p -> {
                    if (p.entityId() == recorderEid) {
                        positions.add(p);
                    }
                }
                case DamageEvent d -> {
                    // 只有当 recorder 是攻击者或受害者时才记录
                    boolean recorderIsAttacker = d.attackerEid() == recorderEid;
                    boolean recorderIsVictim = d.victimEid() == recorderEid;
                    if (recorderIsAttacker || recorderIsVictim) {
                        damages.add(d);
                        if (firstContactTime < 0) {
                            firstContactTime = clockOf(d.timestamp());
                        }
                    }
                }
                case com.wotb.core.replay.event.BattleEndedEvent b -> {
                    if (Float.isNaN(battleEndClock)) {
                        battleEndClock = clockOf(b.timestamp());
                    }
                }
                default -> {}
            }
        }

        // 压缩移动段（只针对 recorder）
        final List<MovementSegment> movements = compressMovements(positions);

        // 交火段
        final List<EngagementSummary> engagements = buildEngagements(damages, recorder.entityId());

        // 战斗阶段
        final float battleStart = findBattleStart(positions, damages);
        final List<BattlePhaseSummary> phases = DefaultBattleFeatureExtractor.dividePhases(
                events, battleEndClock, firstContactTime);

        // 关键事件
        final List<KeyBattleEvent> keyEvents = extractRecorderKeyEvents(damages, recorder);

        return new PlayerBattleFeatureSet(movements, engagements, phases, keyEvents,
                List.of(), true);
    }

    static List<MovementSegment> compressMovements(List<PositionChangedEvent> positions) {
        if (positions.isEmpty()) return List.of();
        if (positions.size() == 1) {
            return List.of(new MovementSegment(clockOf(positions.get(0).timestamp()),
                    clockOf(positions.get(0).timestamp()),
                    MovementType.STATIONARY,
                    new Vector3(positions.get(0).x(), positions.get(0).y(), positions.get(0).z()),
                    new Vector3(positions.get(0).x(), positions.get(0).y(), positions.get(0).z()),
                    0f, 0f, com.wotb.core.replay.event.DecodeConfidence.EXACT));
        }

        final List<MovementSegment> result = new ArrayList<>();
        int start = 0;
        for (int i = 1; i < positions.size(); i++) {
            final float dx = positions.get(i).x() - positions.get(start).x();
            final float dz = positions.get(i).z() - positions.get(start).z();
            final float totalDist = (float) Math.sqrt(dx * dx + dz * dz);
            final float segmentTime = clockOf(positions.get(i).timestamp())
                    - clockOf(positions.get(start).timestamp());

            if (segmentTime <= 0.1f) continue;

            final boolean stationary = totalDist < STATIONARY_THRESHOLD;
            if (i < positions.size() - 1) {
                // 检查下一段是否同类型
                final float nextDx = positions.get(i + 1).x() - positions.get(i).x();
                final float nextDz = positions.get(i + 1).z() - positions.get(i).z();
                final float nextDist = (float) Math.sqrt(nextDx * nextDx + nextDz * nextDz);
                boolean nextStationary = nextDist < STATIONARY_THRESHOLD;
                if (stationary == nextStationary && i - start > 1) continue;
            }

            result.add(new MovementSegment(
                    clockOf(positions.get(start).timestamp()),
                    clockOf(positions.get(i).timestamp()),
                    stationary ? MovementType.STATIONARY : MovementType.MOVING,
                    new Vector3(positions.get(start).x(), positions.get(start).y(), positions.get(start).z()),
                    new Vector3(positions.get(i).x(), positions.get(i).y(), positions.get(i).z()),
                    totalDist, segmentTime > 0 ? totalDist / segmentTime : 0f,
                    com.wotb.core.replay.event.DecodeConfidence.EXACT));
            start = i;
        }
        return result;
    }

    static List<EngagementSummary> buildEngagements(List<DamageEvent> damages, int recorderEid) {
        if (damages.isEmpty()) return List.of();
        final List<DamageEvent> sorted = damages.stream()
                .sorted(Comparator.comparingDouble(d -> clockOf(d.timestamp())))
                .toList();
        final List<EngagementSummary> result = new ArrayList<>();
        int segStart = 0;
        for (int i = 1; i < sorted.size(); i++) {
            if (clockOf(sorted.get(i).timestamp()) - clockOf(sorted.get(i - 1).timestamp()) > ENGAGEMENT_GAP_SEC) {
                result.add(buildEngagementSegment(sorted.subList(segStart, i), recorderEid));
                segStart = i;
            }
        }
        if (segStart < sorted.size()) {
            result.add(buildEngagementSegment(sorted.subList(segStart, sorted.size()), recorderEid));
        }
        return result;
    }

    private static EngagementSummary buildEngagementSegment(List<DamageEvent> events, int recorderEid) {
        int dealt = 0, received = 0;
        for (final DamageEvent d : events) {
            if (d.attackerEid() == recorderEid) dealt += d.damage();
            if (d.victimEid() == recorderEid) received += d.damage();
        }
        EngagementOutcome outcome = (dealt > received * 1.25)
                ? EngagementOutcome.FAVORABLE
                : (received > dealt * 1.25)
                ? EngagementOutcome.UNFAVORABLE
                : EngagementOutcome.EVEN;

        return new EngagementSummary(
                clockOf(events.getFirst().timestamp()),
                clockOf(events.getLast().timestamp()),
                List.of(), List.of(), dealt, received,
                null, null, outcome, com.wotb.core.replay.event.DecodeConfidence.INFERRED);
    }

    static List<KeyBattleEvent> extractRecorderKeyEvents(
            List<DamageEvent> damages, RecorderEntityMapping recorder) {
        final List<KeyBattleEvent> keyEvents = new ArrayList<>();
        boolean firstBlood = false;
        int totalEvents = 0;

        for (final DamageEvent d : damages) {
            if (totalEvents >= MAX_KEY_EVENTS) break;
            if (!firstBlood) {
                firstBlood = true;
                keyEvents.add(new KeyBattleEvent(clockOf(d.timestamp()), "RECORDER_FIRST_BLOOD",
                        "录像者首次伤害 " + d.damage()));
            } else {
                keyEvents.add(new KeyBattleEvent(clockOf(d.timestamp()),
                        d.attackerEid() == recorder.entityId() ? "RECORDER_DAMAGE_DEALT" : "RECORDER_DAMAGE_RECEIVED",
                        "录像者 " + d.damage()));
            }
            totalEvents++;
        }
        return keyEvents;
    }

    private static float findBattleStart(List<PositionChangedEvent> positions, List<DamageEvent> damages) {
        if (!positions.isEmpty()) return clockOf(positions.getFirst().timestamp());
        if (!damages.isEmpty()) return clockOf(damages.getFirst().timestamp());
        return 0f;
    }

    static float clockOf(ReplayTimestamp ts) {
        if (ts == null) return 0f;
        return ts.battleClockSec() != null ? ts.battleClockSec() : ts.rawClockSec();
    }
}