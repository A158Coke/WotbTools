package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.BattleEndedEvent;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.VehicleDestroyedEvent;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.Vector3;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 默认战斗特征提取器。
 * <p>
 * 职责：
 * <ul>
 *   <li>压缩高频位置流为 MovementSegment</li>
 *   <li>识别交火段 EngagementSummary</li>
 *   <li>划分战斗阶段 BattlePhaseSummary</li>
 *   <li>提取关键事件 KeyBattleEvent</li>
 *   <li>构建完整 SingleBattleAnalysisContext</li>
 * </ul>
 * </p>
 */
public class DefaultBattleFeatureExtractor implements BattleFeatureExtractor {

    static final int DAMAGE_SPIKE_THRESHOLD = 400;
    static final int MAX_KEY_EVENTS = 60;
    static final int ENGAGEMENT_GAP_SEC = 15;  // 相邻伤害间隔 ≤15s 视为同一次交火
    static final float STATIONARY_THRESHOLD = 3f; // 移动 <3m 视为静止
    static final float OPENING_DURATION = 45f;   // 开局阶段 45 秒
    static final int LATE_GAME_VEHICLES = 6;     // 存活 ≤6 辆进入后期

    @Override
    public BattleFeatureSet extract(ReplayReconstruction reconstruction, BattleStateSnapshot finalState) {
        final String battleId = battleId(reconstruction);
        final List<ReplayEvent> events = reconstruction.events();

        // 建立 entityId → accountId 映射
        final Map<Integer, Long> entityToAccount = new HashMap<>();
        for (final ReplayEvent e : events) {
            if (e instanceof ParticipantMappingEvent pm) {
                entityToAccount.put(pm.entityId(), pm.accountId());
            }
        }

        // 1. 提取录像者相关的位置事件
        final List<PositionChangedEvent> positions = new ArrayList<>();
        final Map<Integer, List<PositionChangedEvent>> positionsByEntity = new HashMap<>();
        final List<DamageEvent> damages = new ArrayList<>();
        float battleEndClock = Float.NaN;

        for (final ReplayEvent event : events) {
            switch (event) {
                case PositionChangedEvent p -> {
                    positions.add(p);
                    positionsByEntity.computeIfAbsent(p.entityId(), k -> new ArrayList<>()).add(p);
                }
                case DamageEvent d -> {
                    if (d.damage() > 0) damages.add(d);
                }
                case BattleEndedEvent b -> {
                    if (Float.isNaN(battleEndClock)) {
                        battleEndClock = clockOf(b.timestamp());
                    }
                }
                default -> {}
            }
        }

        // 2. 压缩移动段（基于所有位置事件）
        final List<MovementSegment> movements = compressMovements(positions);

        // 3. 识别交火段（基于伤害事件）
        final List<EngagementSummary> engagements = identifyEngagements(damages, entityToAccount, positionsByEntity);

        // 4. 划分战斗阶段
        final float firstContactTime = findFirstContact(damages);
        final List<BattlePhaseSummary> phases = dividePhases(events, battleEndClock, firstContactTime);

        // 5. 提取关键事件
        final List<KeyBattleEvent> keyEvents = extractKeyEvents(events, entityToAccount);

        return new BattleFeatureSet(battleId, keyEvents, true,
                List.copyOf(positions),
                List.copyOf(movements),
                List.copyOf(engagements),
                List.copyOf(phases));
    }

    // ---- 移动段压缩 ----

    static List<MovementSegment> compressMovements(List<PositionChangedEvent> positions) {
        if (positions.isEmpty()) return List.of();

        // 按 entity 分组压缩
        final Map<Integer, List<MovementSegment>> segmentsByEntity = new HashMap<>();
        positions.stream()
                .map(p -> p.entityId())
                .distinct()
                .forEach(eid -> {
                    final List<PositionChangedEvent> pos = positions.stream()
                            .filter(p -> p.entityId() == eid)
                            .sorted(Comparator.comparingInt(PositionChangedEvent::sequence))
                            .toList();
                    segmentsByEntity.put(eid, compressOneEntity(pos));
                });

        // 返回所有实体的移动段（平铺，按时间排序）
        return segmentsByEntity.values().stream()
                .flatMap(List::stream)
                .sorted(Comparator.comparingDouble(MovementSegment::startTime))
                .toList();
    }

    private static List<MovementSegment> compressOneEntity(List<PositionChangedEvent> positions) {
        if (positions.isEmpty()) return List.of();
        if (positions.size() == 1) {
            final PositionChangedEvent p = positions.getFirst();
            final Vector3 pos = new Vector3(p.x(), p.y(), p.z());
            return List.of(new MovementSegment(
                    clockOf(p.timestamp()), clockOf(p.timestamp()),
                    MovementType.STATIONARY, pos, pos,
                    0f, 0f, DecodeConfidence.EXACT));
        }

        final List<MovementSegment> segments = new ArrayList<>();
        int start = 0;
        for (int i = 1; i < positions.size(); i++) {
            final PositionChangedEvent prev = positions.get(i - 1);
            final PositionChangedEvent curr = positions.get(i);
            final float timeDelta = clockOf(curr.timestamp()) - clockOf(prev.timestamp());

            if (timeDelta <= 0.001f) continue; // 同一时刻跳过

            // 判断移动类型
            final float dx = curr.x() - prev.x();
            final float dz = curr.z() - prev.z();
            final float distance = (float) Math.sqrt(dx * dx + dz * dz);
            final float speed = distance / timeDelta;

            // 连续静止或连续移动归为同段
            final boolean stationary = distance < STATIONARY_THRESHOLD;
            if (i > start) {
                final PositionChangedEvent first = positions.get(start);
                final float segmentDistance = segmentDistance(positions.subList(start, i + 1));
                final float segmentTime = clockOf(curr.timestamp()) - clockOf(first.timestamp());
                final boolean segmentStationary = segmentDistance < STATIONARY_THRESHOLD * (i - start);
                final MovementType type = segmentStationary
                        ? MovementType.STATIONARY
                        : MovementType.MOVING;

                segments.add(new MovementSegment(
                        clockOf(first.timestamp()), clockOf(curr.timestamp()),
                        type, new Vector3(first.x(), first.y(), first.z()),
                        new Vector3(curr.x(), curr.y(), curr.z()),
                        segmentDistance,
                        segmentTime > 0 ? segmentDistance / segmentTime : 0f,
                        DecodeConfidence.EXACT));
                start = i;
            }
        }

        return segments;
    }

    private static float segmentDistance(List<PositionChangedEvent> positions) {
        float total = 0f;
        for (int i = 1; i < positions.size(); i++) {
            final float dx = positions.get(i).x() - positions.get(i - 1).x();
            final float dz = positions.get(i).z() - positions.get(i - 1).z();
            total += (float) Math.sqrt(dx * dx + dz * dz);
        }
        return total;
    }

    // ---- 交火段识别 ----

    static List<EngagementSummary> identifyEngagements(
            List<DamageEvent> damages,
            Map<Integer, Long> entityToAccount,
            Map<Integer, List<PositionChangedEvent>> positionsByEntity) {

        if (damages.isEmpty()) return List.of();

        final List<DamageEvent> sorted = damages.stream()
                .sorted(Comparator.comparingDouble(d -> clockOf(d.timestamp())))
                .toList();

        final List<EngagementSummary> engagements = new ArrayList<>();
        int segStart = 0;

        for (int i = 1; i < sorted.size(); i++) {
            final float gap = clockOf(sorted.get(i).timestamp())
                    - clockOf(sorted.get(i - 1).timestamp());
            if (gap > ENGAGEMENT_GAP_SEC) {
                // 结束一段交火
                engagements.add(buildEngagement(sorted.subList(segStart, i), entityToAccount, positionsByEntity));
                segStart = i;
            }
        }
        // 最后一段
        if (segStart < sorted.size()) {
            engagements.add(buildEngagement(sorted.subList(segStart, sorted.size()), entityToAccount, positionsByEntity));
        }

        return engagements;
    }

    private static EngagementSummary buildEngagement(
            List<DamageEvent> events,
            Map<Integer, Long> entityToAccount,
            Map<Integer, List<PositionChangedEvent>> positionsByEntity) {

        int dealt = 0, received = 0;
        for (final DamageEvent d : events) {
            dealt += d.damage();
            received += d.damage();
        }

        final float startTime = clockOf(events.getFirst().timestamp());
        final float endTime = clockOf(events.getLast().timestamp());

        EngagementOutcome outcome;
        if (dealt > received * 1.25) outcome = EngagementOutcome.FAVORABLE;
        else if (received > dealt * 1.25) outcome = EngagementOutcome.UNFAVORABLE;
        else outcome = EngagementOutcome.EVEN;

        return new EngagementSummary(
                startTime, endTime,
                List.of(), List.of(), dealt, received,
                null, null, outcome, DecodeConfidence.INFERRED);
    }

    // ---- 战斗阶段划分 ----

    static List<BattlePhaseSummary> dividePhases(
            List<ReplayEvent> events, float battleEndClock, float firstContactTime) {

        final List<BattlePhaseSummary> phases = new ArrayList<>();
        float battleStart = findBattleStart(events);

        // PRE_BATTLE: 0 ~ 正式开战
        if (battleStart > 0) {
            phases.add(new BattlePhaseSummary(0, battleStart, BattlePhaseSummary.BattlePhaseType.PRE_BATTLE, DecodeConfidence.EXACT));
        }

        if (battleEndClock > 0 && !Float.isNaN(battleEndClock)) {
            // OPENING: 开局 ~ firstContact 或 开战后 45 秒
            final float openingEnd = (firstContactTime > 0)
                    ? Math.min(firstContactTime, battleStart + OPENING_DURATION)
                    : battleStart + OPENING_DURATION;
            phases.add(new BattlePhaseSummary(
                    battleStart, openingEnd,
                    BattlePhaseSummary.BattlePhaseType.OPENING, DecodeConfidence.EXACT));

            if (firstContactTime > 0 && firstContactTime <= openingEnd + 5) {
                phases.add(new BattlePhaseSummary(
                        firstContactTime, Math.min(firstContactTime + 10, battleEndClock),
                        BattlePhaseSummary.BattlePhaseType.FIRST_CONTACT, DecodeConfidence.INFERRED));
            }

            // 剩余时间粗略分为 MID / LATE / END
            if (battleEndClock - openingEnd > 60) {
                phases.add(new BattlePhaseSummary(
                        openingEnd, battleEndClock,
                        BattlePhaseSummary.BattlePhaseType.MID_GAME, DecodeConfidence.INFERRED));
            }

            phases.add(new BattlePhaseSummary(
                    battleEndClock, battleEndClock,
                    BattlePhaseSummary.BattlePhaseType.ENDGAME, DecodeConfidence.EXACT));
        }

        return phases;
    }

    // ---- 关键事件 ----

    static List<KeyBattleEvent> extractKeyEvents(
            List<ReplayEvent> events, Map<Integer, Long> entityToAccount) {
        final List<KeyBattleEvent> keyEvents = new ArrayList<>();
        boolean firstBloodRecorded = false;

        for (final ReplayEvent event : events) {
            if (keyEvents.size() >= MAX_KEY_EVENTS) break;
            switch (event) {
                case DamageEvent d -> {
                    if (d.damage() <= 0) continue;
                    if (!firstBloodRecorded) {
                        firstBloodRecorded = true;
                        keyEvents.add(new KeyBattleEvent(
                                clockOf(d.timestamp()), "FIRST_BLOOD",
                                "首次伤害 EID" + d.attackerEid()
                                        + " → EID" + d.victimEid() + " (" + d.damage() + ")"));
                    } else if (d.damage() >= DAMAGE_SPIKE_THRESHOLD) {
                        keyEvents.add(new KeyBattleEvent(
                                clockOf(d.timestamp()), "DAMAGE_SPIKE",
                                "高额伤害 EID" + d.attackerEid()
                                        + " → EID" + d.victimEid() + " (" + d.damage() + ")"));
                    }
                }
                case VehicleDestroyedEvent v -> keyEvents.add(new KeyBattleEvent(
                        clockOf(v.timestamp()), "VEHICLE_DESTROYED",
                        "击毁 EID" + v.entityId()
                                + (v.killerEid() != null ? " (击毁者 EID" + v.killerEid() + ")" : "")
                                + (v.inferred() ? " [推断]" : "")));
                case BattleEndedEvent b -> keyEvents.add(new KeyBattleEvent(
                        clockOf(b.timestamp()), "BATTLE_END",
                        "战斗结束" + (b.winnerTeam() != null ? " 胜方队伍 " + b.winnerTeam() : "")));
                default -> {}
            }
        }
        return keyEvents;
    }

    // ---- 辅助 ----

    private static float findBattleStart(List<ReplayEvent> events) {
        // 使用第一个 PositionChangedEvent 或 DamageEvent 的时刻作为战斗开始
        for (final ReplayEvent e : events) {
            if (e instanceof PositionChangedEvent) return clockOf(e.timestamp());
            if (e instanceof DamageEvent) return clockOf(e.timestamp());
        }
        return 0f;
    }

    private static float findFirstContact(List<DamageEvent> damages) {
        return damages.isEmpty() ? -1 : clockOf(damages.getFirst().timestamp());
    }

    private static String battleId(ReplayReconstruction reconstruction) {
        final String arenaId = reconstruction.metadata() != null
                ? reconstruction.metadata().arenaId() : null;
        return (arenaId != null && !arenaId.isBlank()) ? arenaId : "unknown";
    }

    static float clockOf(ReplayTimestamp ts) {
        if (ts == null) return 0f;
        return ts.battleClockSec() != null ? ts.battleClockSec() : ts.rawClockSec();
    }
}