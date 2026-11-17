package com.wotb.core.replay.timeline;

import com.wotb.core.model.Battle;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.facts.AoiObservationSegment;
import com.wotb.core.replay.facts.ReplayAoiLifecycle;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.LifeState;
import com.wotb.core.replay.reconstruction.Vector3;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/** Builds the ordered event stream and per-entity vehicle snapshots for each frame. */
final class TimelineFrameAssembler {
    private TimelineFrameAssembler() {
    }

    /** 事件按 (battle-relative 时间, sequence) 排序；非有限时间戳的事件剔除并计数。 */
    static List<ReplayEvent> orderedEvents(
            final List<ReplayEvent> events, final double startRawClockSec) {
        final List<ReplayEvent> ordered = new ArrayList<>();
        for (final ReplayEvent e : events) {
            final double t = TimelineClock.battleClockOf(e, startRawClockSec);
            if (Double.isFinite(t)) {
                ordered.add(e);
            }
        }
        ordered.sort(Comparator.comparingDouble((ReplayEvent e) ->
                        TimelineClock.battleClockOf(e, startRawClockSec))
                .thenComparingInt(ReplayEvent::sequence));
        return ordered;
    }

    static List<ReplayEvent> eventsInWindow(
            final List<ReplayEvent> orderedEvents,
            final double startRawClockSec,
            final double startExclusive,
            final double endInclusive) {
        if (orderedEvents.isEmpty()) {
            return List.of();
        }
        final List<ReplayEvent> out = new ArrayList<>();
        for (final ReplayEvent e : orderedEvents) {
            final double t = TimelineClock.battleClockOf(e, startRawClockSec);
            if (t > endInclusive) {
                break;
            }
            // Pre-battle events remain available in the canonical event stream for
            // provenance, but they are not active-battle frame events. In particular,
            // frame 0 must not absorb an INITIALIZED event from t < 0.
            if (t < 0d) {
                continue;
            }
            if (t > startExclusive) {
                out.add(e);
            }
        }
        return out;
    }

    // ===== frame vehicle construction =====

    static FrameVehicle frameVehicle(
            final int entityId,
            final double t,
            final EntityIndex index,
            final TeamEntityMapping mapping,
            final Battle battle,
            final int perspectiveTeam,
            final TimelineMapEnricher enricher,
            final Map<Integer, List<AoiObservationSegment>> aoiByEntity) {

        final Identity identity = identityOf(entityId, mapping, battle);
        final boolean friendly = identity.team() != null && identity.team() == perspectiveTeam;

        // position knowledge（canonical AoI authority，禁止再用 5s/packet-age 推断）
        final EntityIndex.PosSample pos = index.lastPositionAtOrBefore(entityId, t);
        FramePosition position;
        VehicleKnowledgeState knowledge;
        if (pos == null) {
            position = FramePosition.UNKNOWN;
            knowledge = VehicleKnowledgeState.UNKNOWN;
        } else {
            final double age = t - pos.clock();
            // 当前帧是否位于 open observed segment（entityId + frame time 查询）：
            // - 位于 observed segment 且位置样本来自本段（observedFrom ≤ pos.clock）→
            //   CURRENT carry-forward（静止车辆即使 >5s 无 Type10 也不降级）；
            // - 位于 UNKNOWN_AOI gap / 位置样本跨 gap（来自上一段）→ LAST_KNOWN
            //   （不插值、不前进；closed segment 不允许把 last-known 当 current）。
            final AoiObservationSegment aoiSeg =
                    ReplayAoiLifecycle.segmentAt(aoiByEntity, entityId, t);
            final boolean active = aoiSeg != null
                    && pos.clock() >= aoiSeg.observedFromSec() - 1e-9;
            final PositionKnowledge pk = active
                    ? PositionKnowledge.CURRENT : PositionKnowledge.LAST_KNOWN;
            final PositionSource source = age <= 1e-3
                    ? PositionSource.OBSERVED_EVENT : PositionSource.CARRIED_FORWARD;
            final Confidence conf = active ? Confidence.HIGH : Confidence.MEDIUM;
            position = new FramePosition(
                    new Vector3(pos.x(), pos.y(), pos.z()), pos.clock(), age, pk, source, conf);
            knowledge = active
                    ? VehicleKnowledgeState.POSITION_STREAM_ACTIVE
                    : VehicleKnowledgeState.LAST_KNOWN;
        }

        // health
        final EntityIndex.HpSample hp = index.lastHealthAtOrBefore(entityId, t);
        final FrameHealth health = buildHealth(hp, t, index, aoiByEntity, entityId);

        // destroyed-known (world fact at t): latest reliable life sample
        final var destroyed = index.destroyedInfoAt(entityId, t);
        final LifeState lifeState = destroyed.destroyed()
                ? LifeState.DESTROYED
                : (hp != null && Boolean.TRUE.equals(hp.alive())) ? LifeState.ALIVE
                : (hp != null && hp.currentHp() != null && hp.currentHp() > 0) ? LifeState.ALIVE
                : LifeState.UNKNOWN;
        if (destroyed.destroyed()) {
            knowledge = VehicleKnowledgeState.DESTROYED_KNOWN;
        }

        // orientation
        final EntityIndex.TurretSample turret = index.lastTurretAtOrBefore(entityId, t);
        FrameOrientation orientation = FrameOrientation.UNKNOWN;
        if (pos != null && pos.yawDeg() != null) {
            final Float rel = turret == null ? null : (float) turret.relYawDeg();
            final Float world = rel == null ? null
                    : FrameOrientation.normalizeDeg(pos.yawDeg() + rel);
            final double observed = Math.max(pos.clock(), turret == null ? -1 : turret.clock());
            // 敌方离开 AoI → 方向降为 LAST_KNOWN（不能继续表现为实时炮塔方向）。
            final AoiObservationSegment aoiSeg = ReplayAoiLifecycle.segmentAt(aoiByEntity, entityId, t);
            final boolean active = aoiSeg != null
                    && pos.clock() >= aoiSeg.observedFromSec() - 1e-9;
            final FrameOrientation.OrientationKnowledge ok = active
                    ? FrameOrientation.OrientationKnowledge.CURRENT
                    : FrameOrientation.OrientationKnowledge.LAST_KNOWN;
            orientation = new FrameOrientation(pos.yawDeg(), rel, world,
                    observed, t - observed, ok,
                    active ? Confidence.HIGH : Confidence.MEDIUM);
        }

        // no cumulative damage on the canonical vehicle frame. DamageEvent raw value is NOT
        // authoritative HP delta; authoritative HP loss lives in PlaybackCombatReconstruction. The
        // cumulative dealt/received that previously lived here were write-only and never consumed.

        final FrameMapState mapState = enricher.enrich(pos);

        return new FrameVehicle(
                entityId,
                identity.accountId(),
                identity.nickname(),
                identity.tankId(),
                identity.tankName(),
                identity.tankClass(),
                identity.tankTier(),
                identity.team(),
                friendly,
                lifeState,
                health,
                position,
                orientation,
                mapState,
                knowledge,
                destroyed.destroyed() ? destroyed.destroyedAtSec() : null,
                List.of());
    }

    private static FrameHealth buildHealth(
            final EntityIndex.HpSample hp,
            final double t,
            final EntityIndex index,
            final Map<Integer, List<AoiObservationSegment>> aoiByEntity,
            final int entityId) {
        if (hp == null) {
            return FrameHealth.unknown();
        }
        final Integer current = hp.currentHp();
        final double age = t - hp.clock();
        final HpSource source = hp.confidence() == DecodeConfidence.EXACT
                ? HpSource.EXACT_BATTLE_EVENT : HpSource.INFERRED;
        final Confidence conf = hp.confidence() == DecodeConfidence.EXACT
                ? Confidence.HIGH : Confidence.MEDIUM;
        // HP knowledge 与 AoI observation boundary 一致：t 在 open observed segment 且采样来自本段
        // → CURRENT；t 在 UNKNOWN_AOI gap / 采样跨 hidden interval → LAST_KNOWN。
        final AoiObservationSegment aoiSeg = ReplayAoiLifecycle.segmentAt(aoiByEntity, entityId, t);
        final boolean active = aoiSeg != null && hp.clock() >= aoiSeg.observedFromSec() - 1e-9;
        final FrameHealth.HealthKnowledge knowledge = active
                ? FrameHealth.HealthKnowledge.CURRENT
                : FrameHealth.HealthKnowledge.LAST_KNOWN;
        final Integer displayCapacity = index.displayCapacityHpAt(entityId, t);
        return new FrameHealth(current, hp.clock(), age, source, knowledge, displayCapacity, conf);
    }

    record Identity(Long accountId, String nickname, Integer tankId,
                    String tankName, String tankClass, Integer tankTier,
                    Integer team, Integer baseHp) {
    }

    private static Identity identityOf(
            final int entityId,
            final TeamEntityMapping mapping,
            final Battle battle) {
        final var identity = mapping.identity(entityId);
        final Long accountId = identity != null && identity.accountId() > 0
                ? identity.accountId() : null;
        final String nickname = identity != null ? identity.nickname() : null;
        final long tankId = identity != null && identity.tankId() > 0
                ? identity.tankId() : 0L;
        final Integer team = identity != null && identity.team() > 0
                ? identity.team() : null;
        final String tankName = tankId > 0
                ? ReplayDisplayNames.tankName(tankId, "") : null;
        final String tankClass = tankId > 0
                ? ReplayDisplayNames.tankClass(tankId) : null;
        final Integer tankTier = tankId > 0 ? parseTier(ReplayDisplayNames.tankTier(tankId)) : null;
        final Integer baseHp = tankId > 0 ? ReplayDisplayNames.tankMaxHpValue(tankId) : null;
        return new Identity(accountId, nickname, (int) tankId,
                tankName, tankClass, tankTier, team, baseHp);
    }

    private static Integer parseTier(final String tier) {
        if (tier == null || tier.isBlank()) {
            return null;
        }
        try {
            return Integer.valueOf(tier.trim());
        } catch (final NumberFormatException e) {
            return null;
        }
    }

}
