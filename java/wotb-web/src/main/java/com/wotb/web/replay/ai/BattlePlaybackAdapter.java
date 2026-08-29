package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.EntryHpSource;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.SupremacyPointsChangedEvent;
import com.wotb.core.replay.event.VehicleDestroyedEvent;
import com.wotb.core.replay.event.VehicleHitEvent;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.timeline.BattleFrame;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.timeline.FrameVehicle;
import com.wotb.core.util.PlayerResultFormat;
import com.wotb.web.replay.dto.MapOverview;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * BattlePlaybackAdapter（docs/current-plan.md §40/§42）：从 Canonical BattleTimeline 派生
 * {@link MapOverview.Playback} 契约（duration / positionIntervals / hpSamples / directionSamples /
 * deathSec / events / pointsSamples），不再独立重扫 raw events 形成第二套事实模型。
 * <p>与 {@link MapOverviewBuilder} 同一 battle-relative 时钟口径；位置上报区间 =
 * canonical AoI observed segment（{@link AoiPositionCoverage}）∩ 实际位置存在，阵亡/时长 clamp 一致；
 * 同一 open segment 内不再按 5s packet-gap 切分（P0-1 AoI 唯一 authority）。</p>
 */
public final class BattlePlaybackAdapter {

    private BattlePlaybackAdapter() {
    }

    public static MapOverview.Playback build(
            final Battle battle,
            final BattleTimeline timeline,
            final TeamEntityMapping mapping) {
        if (battle == null || timeline == null || battle.players == null || mapping == null) {
            return null;
        }
        final double duration = timeline.durationSec();
        if (!(duration > 0)) {
            return null;
        }
        final Long recorderAccount = recorderAccountId(battle);
        // 战斗事实重建（§11–§17 共享推导，MapOverviewBuilder 同源）：权威 HP loss + 击毁
        final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result combat =
                com.wotb.core.replay.feature.PlaybackCombatReconstruction.derive(
                        timeline.events(), mapping, timeline.battleStartRawClockSec(), duration);
        // §B9：结算缺失但回放已证明击毁（combat.destroyed）时，位置覆盖不得越过该击毁时刻
        // （禁阵亡后残余位置），与 MapOverviewBuilder 同源。
        final Map<Long, Double> destroyByAccount = new HashMap<>();
        for (final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Destroyed d
                : combat.destroyed()) {
            destroyByAccount.putIfAbsent(d.victimAccountId(), d.timeSec());
        }
        final List<MapOverview.PlaybackVehicle> vehicles = new ArrayList<>();
        for (final PlayerResult player : battle.players) {
            if (player.team <= 0 || player.accountId <= 0) {
                continue;
            }
            final List<Integer> entityIds = mapping.entityIdsByAccount()
                    .getOrDefault(player.accountId, List.of());
            if (entityIds.isEmpty()) {
                continue;
            }
            final Double rawDeath = player.survived ? null : deathSec(player);
            final Double deathSec = rawDeath == null ? null : Math.min(rawDeath, duration);
            final List<MapOverview.PositionInterval> intervals =
                    clampIntervalsToDestroyed(
                            positionIntervals(timeline, entityIds, deathSec, duration),
                            destroyByAccount.get(player.accountId));
            final List<MapOverview.DirectionSample> directions =
                    directionSamples(timeline, entityIds, deathSec, duration);
            final List<MapOverview.HpSample> hpSamples =
                    hpSamples(timeline, entityIds, player.accountId, duration);
            vehicles.add(new MapOverview.PlaybackVehicle(
                    player.accountId, player.nickname, player.tankId,
                    ReplayDisplayNames.tankName(player.tankId, player.tankName), player.team,
                    intervals, deathSec, directions,
                    // baseHp = Tankopedia 静态参考（metadata，不进本局百分比）；
                    // observedCapacityHp = 纯回放观测（真实可信 Type-7 positive sample 最大值；
                    //   无可信 sample 为 null；绝不 max(观测, base)/fallback base）
                    ReplayDisplayNames.tankMaxHpValue(player.tankId),
                    MapOverview.observedCapacityHpOf(hpSamples),
                    hpSamples,
                    tankTypeOf(player),
                    player.entryHpSource == null ? null : player.entryHpSource.name(),
                    player.entryHpSource == EntryHpSource.OBSERVED_EXACT ? player.entryHp : null,
                    hpLossesOf(player.accountId, combat),
                    finalStats(player)));
        }
        if (vehicles.isEmpty()) {
            return null;
        }

        final List<MapOverview.PlaybackEvent> events = new ArrayList<>();
        final java.util.Set<Long> destroyedVictims = new java.util.HashSet<>();
        for (final ReplayEvent event : timeline.events()) {
            if (event instanceof DamageEvent damage) {
                final long victim = accountOf(damage.victimEid(), mapping);
                if (victim <= 0) {
                    continue;
                }
                final long attacker = accountOf(damage.attackerEid(), mapping);
                final double t = battleClockOf(event, timeline);
                events.add(new MapOverview.PlaybackEvent(
                        "DAMAGE", t, attacker > 0 ? attacker : null,
                        victim, damage.damage(),
                        com.wotb.core.replay.feature.PlaybackCombatReconstruction
                                .observedHpLossAt(combat, victim, t)));
            } else if (event instanceof VehicleHitEvent hit) {
                // PR147 §33: method8 is a hit/result-feedback family (VehicleHitEvent); a proven hit is the
                // engagement marker. Authoritative HP-loss (Type7 delta) is the DAMAGE value.
                final long victim = accountOf(hit.victimEntityId(), mapping);
                if (victim <= 0) {
                    continue;
                }
                final long attacker = accountOf(hit.attackerEntityId(), mapping);
                final double t = battleClockOf(event, timeline);
                final Integer hpLoss = com.wotb.core.replay.feature.PlaybackCombatReconstruction
                        .observedHpLossAt(combat, victim, t);
                events.add(new MapOverview.PlaybackEvent(
                        "DAMAGE", t, attacker > 0 ? attacker : null,
                        victim, hpLoss == null ? 0 : hpLoss, hpLoss));
            } else if (event instanceof VehicleDestroyedEvent destroyed) {
                final long victim = accountOf(destroyed.entityId(), mapping);
                if (victim <= 0) {
                    continue;
                }
                destroyedVictims.add(victim);
                events.add(new MapOverview.PlaybackEvent(
                        "DESTROYED", battleClockOf(event, timeline), victim, null, null, null));
                final Integer killerEid = destroyed.killerEid();
                final long killer = killerEid != null ? accountOf(killerEid, mapping) : 0L;
                if (killer > 0 && killer != victim) {
                    events.add(new MapOverview.PlaybackEvent(
                            "KILL", battleClockOf(event, timeline), killer, victim, null, null));
                }
            }
        }
        // 权威击毁推导（type-7 alive=false/HP=0）：不被显式 VehicleDestroyedEvent 覆盖的受害者
        for (final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Destroyed d
                : combat.destroyed()) {
            if (destroyedVictims.contains(d.victimAccountId())) {
                continue;
            }
            events.add(new MapOverview.PlaybackEvent(
                    "DESTROYED", d.timeSec(), d.victimAccountId(), null, null, null));
            if (d.killerAccountId() != null && d.killerAccountId() != d.victimAccountId()) {
                events.add(new MapOverview.PlaybackEvent(
                        "KILL", d.timeSec(), d.killerAccountId(), d.victimAccountId(), null, null));
            }
        }
        for (final MapOverview.PlaybackVehicle vehicle : vehicles) {
            if (recorderAccount != null && vehicle.accountId() == recorderAccount) {
                continue;
            }
            for (final MapOverview.PositionInterval interval : vehicle.positionIntervals()) {
                events.add(new MapOverview.PlaybackEvent(
                        "POSITION_REPORTED", interval.startSec(), vehicle.accountId(), null, null, null));
                events.add(new MapOverview.PlaybackEvent(
                        "POSITION_STALE", interval.endSec(), vehicle.accountId(), null, null, null));
            }
        }
        events.removeIf(e -> !Double.isFinite(e.timeSec())
                || e.timeSec() < 0 || e.timeSec() > duration + 1e-6);
        events.sort(Comparator.comparingDouble(MapOverview.PlaybackEvent::timeSec));

        return new MapOverview.Playback(duration, vehicles, events,
                pointsSamples(timeline, duration));
    }

    /**
     * 位置上报区间 = canonical AoI observed segment（ReplayAoiLifecycle）∩ 实际位置存在范围，
     * 再经 deathSec / duration clamp。同一 open segment 内<b>不再</b>做 5 秒 packet-gap splitting
     * （静止车辆即使 >5s 无 Type10 也不产生 POSITION_STALE）——与 MapOverviewBuilder 同源
     * （{@link AoiPositionCoverage}）。
     */
    static List<MapOverview.PositionInterval> positionIntervals(
            final BattleTimeline timeline,
            final List<Integer> entityIds,
            final Double deathSec,
            final double duration) {
        final Map<Integer, List<Double>> positionTimesByEntity = positionTimesByEntity(timeline, entityIds);
        return AoiPositionCoverage.intervals(
                timeline.aoiSegments(), entityIds, positionTimesByEntity, deathSec, duration);
    }

    /** 该账号各实体的位置样本时刻（battle-relative，按 entityId 分组、各自去重升序；保留 entity provenance）。 */
    private static Map<Integer, List<Double>> positionTimesByEntity(
            final BattleTimeline timeline, final List<Integer> entityIds) {
        final java.util.Set<Integer> idSet = java.util.Set.copyOf(entityIds);
        final Map<Integer, java.util.TreeSet<Double>> byEntity = new HashMap<>();
        if (timeline.frames() != null) {
            for (final BattleFrame frame : timeline.frames()) {
                for (final FrameVehicle v : frame.vehicles()) {
                    if (v == null || !idSet.contains(v.entityId())
                            || v.position() == null || v.position().position() == null) {
                        continue;
                    }
                    final Double at = v.position().positionObservedAtSec();
                    if (at != null && Double.isFinite(at)) {
                        byEntity.computeIfAbsent(v.entityId(), k -> new java.util.TreeSet<>()).add(at);
                    }
                }
            }
        }
        final Map<Integer, List<Double>> out = new HashMap<>();
        byEntity.forEach((eid, times) -> out.put(eid, new ArrayList<>(times)));
        return out;
    }

    /** §B9：把位置覆盖区间按「权威击毁时刻」收口（击毁后整体剔除、跨越击毁末端 clamp），与 MapOverviewBuilder 同源。 */
    private static List<MapOverview.PositionInterval> clampIntervalsToDestroyed(
            final List<MapOverview.PositionInterval> intervals, final Double destroySec) {
        if (destroySec == null || intervals == null || intervals.isEmpty()) {
            return intervals;
        }
        final List<MapOverview.PositionInterval> out = new ArrayList<>();
        for (final MapOverview.PositionInterval it : intervals) {
            if (it.startSec() > destroySec + 1e-6) {
                continue;
            }
            final double end = Math.min(it.endSec(), destroySec);
            if (end >= it.startSec() - 1e-6) {
                out.add(new MapOverview.PositionInterval(it.startSec(), Math.max(it.startSec(), end)));
            }
        }
        return out;
    }

    /** 方向采样：每帧 orientation（hull + turret 世界角），约 1s 一次，≤deathSec，段末冻结。 */
    static List<MapOverview.DirectionSample> directionSamples(
            final BattleTimeline timeline,
            final List<Integer> entityIds,
            final Double deathSec,
            final double duration) {
        final List<MapOverview.DirectionSample> out = new ArrayList<>();
        for (final int entityId : entityIds) {
            for (final BattleFrame frame : timeline.frames()) {
                final FrameVehicle v = vehicleIn(frame, entityId);
                if (v == null || v.orientation() == null
                        || v.orientation().hullYawDeg() == null) {
                    continue;
                }
                final double t = frame.stateAtSec();
                if (t < 0 || t > duration + 1e-6
                        || (deathSec != null && t > deathSec + 1e-6)) {
                    continue;
                }
                final Float rel = v.orientation().turretRelativeYawDeg();
                if (rel == null) {
                    // 无炮塔方向证据不伪造朝向（与 MapOverviewBuilder 契约一致）
                    continue;
                }
                out.add(new MapOverview.DirectionSample(
                        t, v.orientation().hullYawDeg(), rel.doubleValue()));
            }
        }
        out.sort(Comparator.comparingDouble(MapOverview.DirectionSample::timeSec));
        return out;
    }

    /**
     * 血量采样：直接消费 timeline 保留的 EXACT type-7 propId=3 事件（与 MapOverviewBuilder 同源、
     * battle-relative 时间、[0, duration]；sentinel 绝不进入）。
     *
     * <p>PR147：HP timeline 与 terminal/death lifecycle 是<b>两条独立权威事实</b>——HP 只由真实
     * Type-7 采样组成，绝不因 destroyed/terminal 事实注入 0（受控溺水证明车辆可在保留正 HP 时阵亡，
     * HP &lt;= 0 不是死亡谓词）；阵亡由 {@code deathSec} / DESTROYED 事件表达。</p>
     */
    static List<MapOverview.HpSample> hpSamples(
            final BattleTimeline timeline,
            final List<Integer> entityIds,
            final long accountId,
            final double duration) {
        final List<MapOverview.HpSample> samples = new ArrayList<>();
        if (timeline.events() == null) {
            return samples;
        }
        final java.util.Set<Integer> idSet = java.util.Set.copyOf(entityIds);
        for (final ReplayEvent event : timeline.events()) {
            if (!(event instanceof HealthChangedEvent hp)
                    || hp.confidence() != com.wotb.core.replay.event.DecodeConfidence.EXACT
                    || hp.currentHealth() == null
                    || !idSet.contains(hp.entityId())) {
                continue;
            }
            if (hp.currentHealth() != 0
                    && !com.wotb.core.replay.event.HealthChangedEvent.isPlausibleHp(hp.currentHealth())) {
                continue;
            }
            final double t = battleClockOf(hp, timeline);
            if (!Double.isFinite(t) || t < 0 || t > duration + 1e-6) {
                continue;
            }
            samples.add(new MapOverview.HpSample(t, hp.currentHealth()));
        }
        // PR147: HP timeline 只由真实 Type-7 采样组成，不因 destroyed/terminal 事实注入 0
        // （受控溺水=保留正 HP 阵亡，HP<=0 不是死亡谓词；阵亡由 deathSec / DESTROYED 事件表达）。
        samples.sort(Comparator.comparingDouble(MapOverview.HpSample::timeSec));
        return samples;
    }

    /** 争霸赛实时点数：只消费 timeline 中保留的回放真实广播（type-8 subtype48 root field12）。 */
    static List<MapOverview.PointsSample> pointsSamples(
            final BattleTimeline timeline, final double duration) {
        final List<MapOverview.PointsSample> samples = new ArrayList<>();
        if (timeline.events() == null) {
            return samples;
        }
        for (final ReplayEvent event : timeline.events()) {
            if (!(event instanceof SupremacyPointsChangedEvent points)
                    || points.confidence() != com.wotb.core.replay.event.DecodeConfidence.EXACT) {
                continue;
            }
            final double t = battleClockOf(points, timeline);
            if (!Double.isFinite(t) || t < 0 || t > duration + 1e-6) {
                continue;
            }
            samples.add(new MapOverview.PointsSample(t, points.team(), points.points()));
        }
        samples.sort(Comparator.comparingDouble(MapOverview.PointsSample::timeSec));
        return samples;
    }

    // ===== helpers =====

    private static FrameVehicle vehicleIn(final BattleFrame frame, final int entityId) {
        if (frame == null || frame.vehicles() == null) {
            return null;
        }
        for (final FrameVehicle v : frame.vehicles()) {
            if (v.entityId() == entityId) {
                return v;
            }
        }
        return null;
    }

    private static long accountOf(final int entityId, final TeamEntityMapping mapping) {
        if (entityId <= 0) {
            return 0L;
        }
        final TeamEntityIdentity identity = mapping.identity(entityId);
        return identity != null ? identity.accountId() : 0L;
    }

    private static Double deathSec(final PlayerResult player) {
        final double deathSec = PlayerResultFormat.deathSec(player);
        return deathSec > 0 ? deathSec : null;
    }

    /**
     * 车辆类型统一 fallback（docs/current-plan.md §8）：replay/player 权威 tankType →
     * tankopedia class（英文，API 纯英文契约）→ 空串（前端展示 —）。
     */
    private static String tankTypeOf(final PlayerResult player) {
        if (player.tankType != null && !player.tankType.isBlank()) {
            return player.tankType;
        }
        return ReplayDisplayNames.tankClassEn(player.tankId);
    }

    /** 车辆 HP loss 记录（共享推导 → DTO；attacker 仅在同攻击者可证明时填充）。 */
    private static List<MapOverview.HpLoss> hpLossesOf(
            final long accountId,
            final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result combat) {
        final List<com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss> losses =
                combat.lossesOf(accountId);
        if (losses.isEmpty()) {
            return List.of();
        }
        final List<MapOverview.HpLoss> out = new ArrayList<>(losses.size());
        for (final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss l : losses) {
            out.add(new MapOverview.HpLoss(l.fromSec(), l.toSec(), l.hpLoss(),
                    l.attackerAccountId(), l.attackerReliable()));
        }
        return out;
    }

    /** 整场最终战绩（结算口径；仅供「最终战绩」分区，不得冒充当前时间点状态）。 */
    private static MapOverview.FinalStats finalStats(final PlayerResult p) {
        return new MapOverview.FinalStats(
                p.damageDealt, p.damageReceived, p.damageAssisted, p.kills,
                p.nShots, p.nHitsDealt, p.nPenetrationsDealt,
                p.nHitsReceived, p.nPenetrationsReceived, p.damageBlocked);
    }

    private static Long recorderAccountId(final Battle battle) {
        final PlayerResult recorder = battle.recorderResult();
        return recorder != null && recorder.accountId > 0 ? recorder.accountId : null;
    }

    private static double battleClockOf(final ReplayEvent event, final BattleTimeline timeline) {
        return com.wotb.core.replay.timeline.TimelineClock.battleClockOf(
                event, timeline.battleStartRawClockSec());
    }
}
