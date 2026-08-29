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

/**
 * 实体观测（AoI）生命周期构建器（计划 §B8/B9）。
 *
 * <p>状态机（research entity-presence-aoi-lifecycle.md）：
 * <pre>
 *   on Type33(eid):   pending entry（pre-materialization announcement，不开启观察）
 *   on Type5(eid):    open OBSERVED_SEGMENT（observedFrom = Type5 时刻）
 *   on Type10(eid):   仅 world-coordinate（attachmentParentEntityId==0）确保段已开；
 *                      attached/local（parent != 0）不得开启 world AoI 段
 *   on Type4(eid):    close OBSERVED_SEGMENT（absentFrom = Type4 时刻）→ UNKNOWN_AOI；
 *                    无开段记录的 orphan Type4 忽略（不伪造零长段）
 * </pre>
 * 段间 gap 是 UNKNOWN_AOI：不得跨 gap 插值，也不得把 last-known 当真实当前位置。</p>
 *
 * <p>对盟友（corpus 238/238 仅入场一次、无 Type4）观测近似连续；
 * 反复 leave→re-entry 是敌方专属（485/485）。</p>
 */
public final class ReplayAoiLifecycle {

    /** 观测来源语义：replay POV（非服务器全局 spotted）。 */
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
                    // pre-materialization announcement：段由 Type5 真正打开
                }
                case MaterializationEvent m -> openSegment(segmentsByEntity, openFrom,
                        m.entityId(), t, m.confidence());
                case PositionChangedEvent p -> {
                    // attached/local transform (attachmentParentEntityId != 0) is a parented/local
                    // frame, not a world-coordinate observation; must not open a world AoI segment.
                    if (p.attachmentParentEntityId() == 0) {
                        openSegment(segmentsByEntity, openFrom,
                                p.entityId(), t, p.confidence());
                    }
                }
                case EntityRemovedEvent removed ->
                        closeSegment(segmentsByEntity, openFrom, removed.entityId(), t);
                default -> {
                    // 其它事件不影响观测段
                }
            }
        }

        // 战斗结束时仍打开的段：absentFrom = null
        final List<AoiObservationSegment> result = new ArrayList<>();
        openFrom.forEach((entityId, from) ->
                result.add(new AoiObservationSegment(entityId, from, null, SOURCE_REPLAY_POV)));
        segmentsByEntity.values().forEach(result::addAll);
        result.sort(Comparator.comparingInt(AoiObservationSegment::entityId)
                .thenComparingDouble(AoiObservationSegment::observedFromSec));
        return List.copyOf(result);
    }

    /**
     * 将观测段按 entityId 分组索引（构建一次，后续帧查询 O(k)）。
     * 这是 BattleTimeline / Playback / MapOverview / FormationDepth 的
     * 唯一 AoI segment 查询入口（canonical authority）。
     */
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

    /**
     * 查询实体在 t 时刻所处的观测段；段间 gap（UNKNOWN_AOI）/ 未观测 → null。
     * 每实体观测段互不重叠（段间即 gap），最多一个段 observesAt(t)。
     */
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

    /** battle-relative 时间；无 battle start 时退回 raw（与 ReplayHpTimeline 同语义）。 */
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
        // 低置信度位置不得开启观测段（防止损坏/噪声位置打开假段）
        if (confidence == DecodeConfidence.PARTIAL || confidence == DecodeConfidence.UNKNOWN) {
            return;
        }
        // 已在段中：忽略重复进入（Type33/Type5 配对内只开一次）
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
            // orphan Type4 (no open observed segment): keep as leave-boundary evidence only — do NOT
            // fabricate a zero-length observed-from-t-to-t interval (that would be a fake AoI segment).
            return;
        }
        segmentsByEntity.computeIfAbsent(entityId, k -> new ArrayList<>())
                .add(new AoiObservationSegment(entityId, from, t, SOURCE_REPLAY_POV));
    }
}
