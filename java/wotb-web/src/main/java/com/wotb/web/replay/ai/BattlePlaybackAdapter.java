package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.TeamEntityIdentity;
import com.wotb.core.processing.TeamEntityMapping;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.evidence.EntryHpSource;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.SupremacyPointsChangedEvent;
import com.wotb.core.replay.event.VehicleDestroyedEvent;
import com.wotb.core.replay.timeline.BattleFrame;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.timeline.FrameVehicle;
import com.wotb.core.replay.timeline.PositionKnowledge;
import com.wotb.core.replay.timeline.VehicleKnowledgeState;
import com.wotb.core.util.PlayerResultFormat;
import com.wotb.web.replay.dto.MapOverview;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * BattlePlaybackAdapter（docs/current-plan.md §40/§42）：从 Canonical BattleTimeline 派生
 * {@link MapOverview.Playback} 契约（duration / positionIntervals / hpSamples / directionSamples /
 * deathSec / events / pointsSamples），不再独立重扫 raw events 形成第二套事实模型。
 * <p>与 {@link MapOverviewBuilder} 同一 battle-relative 时钟口径；位置上报区间 =
 * frame 知识状态（POSITION_STREAM_ACTIVE）连续段（gap>5s 即 LAST_KNOWN），阵亡/时长 clamp 一致。</p>
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
                    positionIntervals(timeline, entityIds, deathSec, duration);
            final List<MapOverview.DirectionSample> directions =
                    directionSamples(timeline, entityIds, deathSec, duration);
            final List<MapOverview.HpSample> hpSamples =
                    hpSamples(timeline, entityIds, player.accountId, duration);
            vehicles.add(new MapOverview.PlaybackVehicle(
                    player.accountId, player.nickname, player.tankId,
                    ReplayDisplayNames.tankName(player.tankId, player.tankName), player.team,
                    intervals, deathSec, directions,
                    // baseHp = Tankopedia 静态参考（metadata，不进本局百分比）；
                    // observedCapacityHp = 回放观测容量（整场观测最大 current HP，下界 base）
                    ReplayDisplayNames.tankMaxHpValue(player.tankId),
                    player.observedMaxHp,
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
                        victim, damage.damage(), observedHpLossOf(victim, t, combat)));
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
     * 位置上报区间 = 服务器位置流覆盖（packet gap > 5s 即中断），与 MapOverviewBuilder 的 gap 聚类等价；
     * 阵亡时刻最终 clamp（阵亡后不出现区间）。
     * <p>PR #103 起己方 FrameVehicle 知识 carry-forward 为 CURRENT（静止不降级），但 playback 覆盖语义
     * 仍是「有包才算覆盖」，故区间判定额外要求 positionAgeSec ≤ POSITION_GAP_SEC（≠ AI 知识状态）。</p>
     */
    private static final double POSITION_GAP_SEC = 5.0;

    static List<MapOverview.PositionInterval> positionIntervals(
            final BattleTimeline timeline,
            final List<Integer> entityIds,
            final Double deathSec,
            final double duration) {
        final List<MapOverview.PositionInterval> raw = new ArrayList<>();
        for (final int entityId : entityIds) {
            Double runStart = null;
            Double runLastObserved = null;
            for (final BattleFrame frame : timeline.frames()) {
                final FrameVehicle v = vehicleIn(frame, entityId);
                // 位置上报区间 = 服务器位置流覆盖（packet gap > 5s 即中断），不是 AI 知识状态：
                // PR #103 起己方 FrameVehicle 知识 carry-forward 为 CURRENT（静止不降级），
                // 但 playback 覆盖语义仍是「有包才算覆盖」，与 MapOverviewBuilder gap 聚类保持一致。
                final boolean active = v != null && v.position() != null
                        && v.position().position() != null
                        && v.position().knowledge() == PositionKnowledge.CURRENT
                        && v.knowledgeState() == VehicleKnowledgeState.POSITION_STREAM_ACTIVE
                        && v.position().positionAgeSec() != null
                        && v.position().positionAgeSec() <= POSITION_GAP_SEC;
                if (active) {
                    final double observed = v.position().positionObservedAtSec();
                    if (runStart == null) {
                        runStart = observed;
                    }
                    runLastObserved = Math.max(runLastObserved == null ? observed : runLastObserved, observed);
                } else if (runStart != null) {
                    raw.add(new MapOverview.PositionInterval(runStart, runLastObserved));
                    runStart = null;
                    runLastObserved = null;
                }
            }
            if (runStart != null) {
                raw.add(new MapOverview.PositionInterval(runStart, runLastObserved));
            }
        }
        raw.sort(Comparator.comparingDouble(MapOverview.PositionInterval::startSec));
        final List<MapOverview.PositionInterval> merged = new ArrayList<>();
        for (final MapOverview.PositionInterval interval : raw) {
            if (merged.isEmpty()
                    || interval.startSec() - merged.get(merged.size() - 1).endSec() > 1e-6) {
                merged.add(interval);
            } else {
                final MapOverview.PositionInterval last = merged.get(merged.size() - 1);
                merged.set(merged.size() - 1, new MapOverview.PositionInterval(
                        last.startSec(), Math.max(last.endSec(), interval.endSec())));
            }
        }
        final List<MapOverview.PositionInterval> clamped = new ArrayList<>();
        for (final MapOverview.PositionInterval interval : merged) {
            if (deathSec != null && interval.startSec() > deathSec + 1e-6) {
                continue;
            }
            final double end = deathSec == null ? interval.endSec()
                    : Math.min(interval.endSec(), deathSec);
            if (interval.startSec() > duration + 1e-6) {
                continue;
            }
            final double boundedEnd = Math.min(end, duration);
            if (boundedEnd >= interval.startSec() - 1e-6) {
                clamped.add(new MapOverview.PositionInterval(
                        interval.startSec(), Math.max(interval.startSec(), boundedEnd)));
            }
        }
        return clamped;
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
     * battle-relative 时间、[0, duration]、含阵亡 0；sentinel 绝不进入）。
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

    /**
     * DAMAGE 事件可证明的掉血值（§11/§12）：仅当该受害者掉血窗口内恰好一条伤害通知
     * （= 唯一攻击者 + 精确 attribution）时非 null；否则 null（前端不得显示伪造精确伤害）。
     */
    private static Integer observedHpLossOf(
            final long victimAccountId,
            final double damageTimeSec,
            final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result combat) {
        for (final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss l
                : combat.lossesOf(victimAccountId)) {
            if (l.damageEventCount() != 1) {
                continue;
            }
            if (damageTimeSec > l.fromSec() + 1e-6 && damageTimeSec <= l.toSec() + 1e-6) {
                return l.hpLoss();
            }
        }
        return null;
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
