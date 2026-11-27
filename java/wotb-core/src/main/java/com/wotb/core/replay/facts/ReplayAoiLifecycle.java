package com.wotb.core.replay.facts;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.EntityRemovedEvent;
import com.wotb.core.replay.event.MaterializationAnnouncedEvent;
import com.wotb.core.replay.event.MaterializationEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class ReplayAoiLifecycle {

    public static final String SOURCE_REPLAY_POV = "REPLAY_POV";

    private ReplayAoiLifecycle() {
    }

    /**
     * 构建所有实体的观测段（battle-relative 秒升序；按事件 (time, seq) 处理）。
     *
     * @param events 全部领域事件
     * @param startRawClockSec battle start 原始时钟（可为 NaN → 退回 raw）
     * @return 观测段列表（按 entityId 分组、段内按 observedFrom 升序）
     */
    public static List<AoiObservationSegment> build(
            final List<ReplayEvent> events,
            final Double startRawClockSec) {
        if (events == null) {
            return List.of();
        }
        final double start = startRawClockSec != null && Double.isFinite(startRawClockSec)
                ? startRawClockSec : Double.NaN;
        final List<ReplayEvent> ordered = events.stream()
                .filter(e -> e != null && e.timestamp() != null)
                .filter(e -> Double.isFinite(clockOf(e, start)))
                .sorted(Comparator.comparingDouble((ReplayEvent e) -> clockOf(e, start))
                        .thenComparingInt(ReplayEvent::sequence))
                .toList();

        final Map<Integer, Double> openFrom = new HashMap<>();
        final Map<Integer, List<AoiObservationSegment>> segmentsByEntity = new HashMap<>();

        for (final ReplayEvent event : ordered) {
            final double t = clockOf(event, start);
            switch (event) {
                case MaterializationAnnouncedEvent ignored -> {
                }
                case MaterializationEvent m -> openSegment(segmentsByEntity, openFrom,
                        m.entityId(), t, m.confidence());
                case PositionChangedEvent p -> {
                    if (p.attachmentParentEntityId() == 0) {
                        openSegment(segmentsByEntity, openFrom,
                                p.entityId(), t, p.confidence());
                    }
                }
                case EntityRemovedEvent removed ->
                        closeSegment(segmentsByEntity, openFrom, removed.entityId(), t);
                default -> {
                }
            }
        }

        final List<AoiObservationSegment> result = new ArrayList<>();
        openFrom.forEach((entityId, from) ->
                result.add(new AoiObservationSegment(entityId, from, null, SOURCE_REPLAY_POV)));
        segmentsByEntity.values().forEach(result::addAll);
        result.sort(Comparator.comparingInt(AoiObservationSegment::entityId)
                .thenComparingDouble(AoiObservationSegment::observedFromSec));
        return List.copyOf(result);
    }

    public static Map<Integer, List<AoiObservationSegment>> indexByEntity(
            final List<AoiObservationSegment> segments) {
        final Map<Integer, List<AoiObservationSegment>> byEntity = new HashMap<>();
        if (segments != null) {
            for (final AoiObservationSegment s : segments) {
                byEntity.computeIfAbsent(s.entityId(), k -> new ArrayList<>()).add(s);
            }
        }
        return byEntity;
    }

    public static AoiObservationSegment segmentAt(
            final Map<Integer, List<AoiObservationSegment>> byEntity,
            final int entityId,
            final double t) {
        for (final AoiObservationSegment s : byEntity.getOrDefault(entityId, List.of())) {
            if (s.observesAt(t)) {
                return s;
            }
        }
        return null;
    }

    private static double clockOf(final ReplayEvent event, final double startRawClockSec) {
        final Float battle = event.timestamp().battleClockSec();
        if (battle != null && Float.isFinite(battle)) {
            return battle;
        }
        if (!Double.isFinite(startRawClockSec)) {
            return event.timestamp().rawClockSec();
        }
        return event.timestamp().rawClockSec() - startRawClockSec;
    }

    private static void openSegment(
            final Map<Integer, List<AoiObservationSegment>> segmentsByEntity,
            final Map<Integer, Double> openFrom,
            final int entityId,
            final double t,
            final DecodeConfidence confidence) {
        if (confidence == DecodeConfidence.PARTIAL || confidence == DecodeConfidence.UNKNOWN) {
            return;
        }
        if (openFrom.containsKey(entityId)) {
            return;
        }
        openFrom.put(entityId, t);
    }

    private static void closeSegment(
            final Map<Integer, List<AoiObservationSegment>> segmentsByEntity,
            final Map<Integer, Double> openFrom,
            final int entityId,
            final double t) {
        final Double from = openFrom.remove(entityId);
        if (from == null) {
            return;
        }
        segmentsByEntity.computeIfAbsent(entityId, k -> new ArrayList<>())
                .add(new AoiObservationSegment(entityId, from, t, SOURCE_REPLAY_POV));
    }
}
