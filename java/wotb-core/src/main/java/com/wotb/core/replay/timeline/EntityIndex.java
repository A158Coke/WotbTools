package com.wotb.core.replay.timeline;

import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.EntityCreatedEvent;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.SupremacyPointsChangedEvent;
import com.wotb.core.replay.event.TurretDirectionChangedEvent;
import com.wotb.core.replay.event.VehicleDestroyedEvent;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 按实体聚合的 battle-relative 事件采样索引（构建 Timeline 的确定性事实源）。
 * <p>所有采样按 battle-relative 时间升序排序；查询 lastAtOrBefore 只返回 time ≤ t 的采样——
 * 天然满足 anti-future-leak invariant（docs/architecture/battle-timeline.md §10）。</p>
 */
final class EntityIndex {

    /** 位置采样（battle-relative 秒 + 原始 XYZ + 车体 yaw 度）。 */
    record PosSample(double clock, float x, float y, float z, Float yawDeg, DecodeConfidence confidence) {
    }

    /** 血量采样：currentHp 仅保留可信正 HP 或 0（sentinel 绝不进入）；alive 来自事件字段。 */
    record HpSample(double clock, Integer currentHp, Boolean alive, DecodeConfidence confidence, int seq) {
    }

    /** 阵亡采样（事件已可靠证明）。 */
    record DestroySample(double clock, int seq) {
    }

    /** 炮塔相对偏航采样（type-7 propId=2，PROVEN）。 */
    record TurretSample(double clock, double relYawDeg) {
    }

    /** 争霸赛点数采样。 */
    record PointsSample(double clock, int team, int points) {
    }

    private final Map<Integer, List<PosSample>> positions;
    private final Map<Integer, List<HpSample>> healths;
    private final Map<Integer, List<DestroySample>> destroys;
    private final Map<Integer, List<TurretSample>> turrets;
    private final List<PointsSample> points;
    private final Map<Integer, Double> firstObserved;
    private final Map<Integer, List<Double>> leaves;
    private final int invalidTimestampEvents;

    private EntityIndex(
            final Map<Integer, List<PosSample>> positions,
            final Map<Integer, List<HpSample>> healths,
            final Map<Integer, List<DestroySample>> destroys,
            final Map<Integer, List<TurretSample>> turrets,
            final List<PointsSample> points,
            final Map<Integer, Double> firstObserved,
            final Map<Integer, List<Double>> leaves,
            final int invalidTimestampEvents) {
        this.positions = positions;
        this.healths = healths;
        this.destroys = destroys;
        this.turrets = turrets;
        this.points = points;
        this.firstObserved = firstObserved;
        this.leaves = leaves;
        this.invalidTimestampEvents = invalidTimestampEvents;
    }

    static EntityIndex collect(final List<ReplayEvent> events, final double startRawClockSec) {
        final Map<Integer, List<PosSample>> positions = new HashMap<>();
        final Map<Integer, List<HpSample>> healths = new HashMap<>();
        final Map<Integer, List<DestroySample>> destroys = new HashMap<>();
        final Map<Integer, List<TurretSample>> turrets = new HashMap<>();
        final List<PointsSample> points = new ArrayList<>();
        final Map<Integer, Double> firstObserved = new HashMap<>();
        final Map<Integer, List<Double>> leaves = new HashMap<>();
        int invalid = 0;

        for (final ReplayEvent event : events) {
            final double t = TimelineClock.battleClockOf(event, startRawClockSec);
            if (!Double.isFinite(t)) {
                invalid++;
                continue;
            }
            switch (event) {
                case PositionChangedEvent p -> {
                    final Float yawDeg = Float.isFinite(p.yaw())
                            ? (float) Math.toDegrees(p.yaw()) : null;
                    positions.computeIfAbsent(p.entityId(), k -> new ArrayList<>())
                            .add(new PosSample(t, p.x(), p.y(), p.z(), yawDeg, p.confidence()));
                    firstObserved.merge(p.entityId(), t, Math::min);
                }
                case HealthChangedEvent h -> {
                    final Integer hp = HealthChangedEvent.isPlausibleHp(h.currentHealth())
                            || (h.currentHealth() != null && h.currentHealth() == 0)
                            ? h.currentHealth() : null;
                    healths.computeIfAbsent(h.entityId(), k -> new ArrayList<>())
                            .add(new HpSample(t, hp, h.alive(), h.confidence(), h.sequence()));
                    firstObserved.merge(h.entityId(), t, Math::min);
                    if (Boolean.FALSE.equals(h.alive())
                            && h.confidence() == DecodeConfidence.EXACT) {
                        destroys.computeIfAbsent(h.entityId(), k -> new ArrayList<>())
                                .add(new DestroySample(t, h.sequence()));
                    }
                }
                case VehicleDestroyedEvent vd -> {
                    if (vd.confidence() != DecodeConfidence.PARTIAL
                            && vd.confidence() != DecodeConfidence.UNKNOWN) {
                        destroys.computeIfAbsent(vd.entityId(), k -> new ArrayList<>())
                                .add(new DestroySample(t, vd.sequence()));
                    }
                    firstObserved.merge(vd.entityId(), t, Math::min);
                }
                case TurretDirectionChangedEvent td -> {
                    turrets.computeIfAbsent(td.entityId(), k -> new ArrayList<>())
                            .add(new TurretSample(t, td.turretRelativeYawDeg()));
                }
                case DamageEvent d -> {
                    // DamageEvent raw value is NOT authoritative HP delta; never feed it into
                    // canonical FrameVehicle damage totals. Only register entity observation.
                    firstObserved.merge(d.attackerEid(), t, Math::min);
                    firstObserved.merge(d.victimEid(), t, Math::min);
                }
                case SupremacyPointsChangedEvent sp -> {
                    if (sp.confidence() == DecodeConfidence.EXACT
                            && (sp.team() == 1 || sp.team() == 2)) {
                        points.add(new PointsSample(t, sp.team(), sp.points()));
                    }
                }
                case EntityCreatedEvent ec -> {
                    // unproven/guessed entityId must not enter canonical firstObserved.
                    if (ec.entityId() > 0) {
                        firstObserved.merge(ec.entityId(), t, Math::min);
                    }
                }
                case com.wotb.core.replay.event.EntityRemovedEvent removed ->
                        leaves.computeIfAbsent(removed.entityId(), k -> new ArrayList<>()).add(t);
                default -> {
                    // 其余事件不影响采样
                }
            }
        }

        leaves.values().forEach(l -> l.sort(Comparator.naturalOrder()));
        positions.values().forEach(l -> l.sort(Comparator.comparingDouble(PosSample::clock)));
        healths.values().forEach(l -> l.sort(Comparator.comparingDouble(HpSample::clock)));
        destroys.values().forEach(l -> l.sort(Comparator.comparingDouble(DestroySample::clock)));
        turrets.values().forEach(l -> l.sort(Comparator.comparingDouble(TurretSample::clock)));
        points.sort(Comparator.comparingDouble(PointsSample::clock));

        return new EntityIndex(positions, healths, destroys, turrets,
                points, firstObserved, leaves, invalid);
    }

    Map<Integer, List<PosSample>> positions() {
        return positions;
    }

    int invalidTimestampEvents() {
        return invalidTimestampEvents;
    }

    /** 在 t 时已存在的实体（first observed ≤ t）。 */
    List<Integer> knownEntityIdsAt(final double t) {
        final List<Integer> out = new ArrayList<>();
        for (final Map.Entry<Integer, Double> e : firstObserved.entrySet()) {
            if (e.getValue() <= t) {
                out.add(e.getKey());
            }
        }
        return out;
    }

    PosSample lastPositionAtOrBefore(final int entityId, final double t) {
        return lastAtOrBefore(positions.get(entityId), t, PosSample::clock);
    }

    HpSample lastHealthAtOrBefore(final int entityId, final double t) {
        return lastAtOrBefore(healths.get(entityId), t, HpSample::clock);
    }

    TurretSample lastTurretAtOrBefore(final int entityId, final double t) {
        return lastAtOrBefore(turrets.get(entityId), t, TurretSample::clock);
    }

    /** 截至 t 的最后一次 EntityLeave（位置流硬中断；无则 null）。 */
    Double lastLeaveAtOrBefore(final int entityId, final double t) {
        final List<Double> list = leaves.get(entityId);
        return lastAtOrBefore(list, t, Double::doubleValue);
    }

    /** 截至 t 的阵亡信息：取最新生命采样（按 clock/seq）。 */
    DestroyedInfo destroyedInfoAt(final int entityId, final double t) {
        final List<DestroySample> list = destroys.get(entityId);
        if (list == null || list.isEmpty()) {
            return new DestroyedInfo(false, null);
        }
        DestroySample latest = null;
        for (final DestroySample s : list) {
            if (s.clock() > t) {
                break;
            }
            latest = s;
        }
        return latest == null
                ? new DestroyedInfo(false, null)
                : new DestroyedInfo(true, latest.clock());
    }

    record DestroyedInfo(boolean destroyed, Double destroyedAtSec) {
    }

    BattleTimelineBuilder.PointsAt pointsAt(final double t, final int perspectiveTeam) {
        Integer friendly = null;
        Integer enemy = null;
        for (final PointsSample s : points) {
            if (s.clock() > t) {
                break;
            }
            if (s.team() == 1) {
                friendly = s.points();
            } else {
                enemy = s.points();
            }
        }
        if (perspectiveTeam == 2) {
            return new BattleTimelineBuilder.PointsAt(enemy, friendly);
        }
        return new BattleTimelineBuilder.PointsAt(friendly, enemy);
    }

    // ===== helpers =====

    private static <T> T lastAtOrBefore(
            final List<T> list, final double t, final java.util.function.ToDoubleFunction<T> clock) {
        if (list == null || list.isEmpty()) {
            return null;
        }
        T result = null;
        for (final T item : list) {
            if (clock.applyAsDouble(item) > t) {
                break;
            }
            result = item;
        }
        return result;
    }

}
