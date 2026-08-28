package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.MapNames;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.processing.TeamPerspectiveResolution;
import com.wotb.core.replay.processing.TeamPerspectiveResolver;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.EntityRemovedEvent;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.RoundFinishedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.SupremacyPointsChangedEvent;
import com.wotb.core.replay.event.TurretDirectionChangedEvent;
import com.wotb.core.replay.event.VehicleDestroyedEvent;
import com.wotb.core.model.EntryHpSource;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.map.MapGridProfile;
import com.wotb.core.replay.map.MapGridRegistry;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.util.PlayerResultFormat;
import com.wotb.web.replay.dto.MapOverview;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 地图鸟瞰聚合器：从权威结算（Battle）+ 事件流重建（ReplayReconstruction）生成
 * {@link MapOverview}（热力 + 路线 + 出生点 + 阶段切片）。
 * <p>口径（与 current-plan 一致）：</p>
 * <ul>
 *   <li>坐标 = 语义坐标（x=回放 x，y=回放 z，与 playableBounds 同系）；</li>
 *   <li>伤害热力按<b>受击方</b>位置落格（受击方口径）；</li>
 *   <li>路线 2s 均匀采样（间隔=max(2s, duration/200)，每车 ≤200 点），
 *       firstObservedSec/lastObservedSec 诚实标注观测区间；</li>
 *   <li>阶段：opening=开局（OPENING+FIRST_CONTACT）、mid=中期、late=残局
 *       （战斗末 {@link BattlePhaseSummary#DENSE_KILL_WINDOW_SEC} 秒窗口）；</li>
 *   <li>降级：未知地图/无语义网格/无名册/无观测/视角未解析 → 返回 null。</li>
 * </ul>
 */
public final class MapOverviewBuilder {

    private MapOverviewBuilder() {
    }

    public static MapOverview build(
            final Battle battle,
            final ReplayReconstruction reconstruction
    ) {
        if (battle == null || reconstruction == null || battle.players == null
                || battle.players.isEmpty()) {
            return null;
        }
        final MapGridProfile profile = MapGridRegistry.profileFor(battle.mapName);
        if (profile == null) {
            return null;
        }
        final Integer friendlyTeam = resolveFriendlyTeam(battle, reconstruction);
        if (friendlyTeam == null) {
            return null;
        }

        final List<ReplayEvent> events = reconstruction.events() == null
                ? List.of() : reconstruction.events();
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, reconstruction);
        if (mapping.entitiesById().isEmpty()) {
            return null;
        }
        final Float battleStart = reconstruction.battleStartRawClockSec();
        final Positions positions = Positions.collect(events, mapping, battleStart);
        if (positions.isEmpty()) {
            return null;
        }

        final List<MapOverview.Route> routes = buildRoutes(battle, mapping, positions,
                friendlyTeam, profile);
        if (routes.isEmpty()) {
            return null;
        }
        final List<DamageEvent> damages = events.stream()
                .filter(DamageEvent.class::isInstance)
                .map(DamageEvent.class::cast)
                .toList();
        // 战斗事实重建（§11–§17 唯一可信伤害源）：热力图伤害用权威 HP loss，不用 Type-8 raw
        final double duration = battle.durationS != null && battle.durationS > 0
                ? battle.durationS.doubleValue()
                : Math.max(0.0, reconstruction.replayDurationSec());
        final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result combat =
                com.wotb.core.replay.feature.PlaybackCombatReconstruction.derive(
                        events, mapping,
                        battleStart == null ? 0.0 : battleStart.doubleValue(), duration);
        final MapOverview.Heatmaps heatmaps = buildHeatmaps(
                battle, mapping, positions, damages, friendlyTeam, profile, battleStart, combat);
        final List<MapOverview.Phase> phases = buildPhases(
                damages, positions, battle, battleStart);
        final MapOverview.Playback playback = buildPlayback(
                battle, mapping, positions, events, battleStart);

        return new MapOverview(
                battle.mapName.trim().toLowerCase(),
                profile.displayName(),
                displayNames(battle.mapName, profile.displayName()),
                friendlyTeam,
                new MapOverview.Bounds(
                        profile.playableBounds().xMin(),
                        profile.playableBounds().xMax(),
                        profile.playableBounds().yMin(),
                        profile.playableBounds().yMax()),
                profile.gridCells().stream()
                        .map(cell -> new MapOverview.GridCell(
                                cell.id(), cell.nineGridRegion(),
                                new MapOverview.Bounds(
                                        cell.bounds().xMin(), cell.bounds().xMax(),
                                        cell.bounds().yMin(), cell.bounds().yMax())))
                        .toList(),
                // 素材信息由前端 mapImages.js 唯一维护（素材开关）；后端 image 恒 null。
                null,
                profile.spawnPoints().stream()
                        .map(s -> new MapOverview.SpawnPoint(s.name(), s.team(), s.x(), s.y()))
                        .toList(),
                phases,
                heatmaps,
                routes,
                battle.arenaBonusType,
                resolveRecorderAccountId(battle),
                playback);
    }


    /**
     * 战局回放数据：车辆（位置复用路线点，这里只补充位置上报区间）+
     * 时间轴事件（DAMAGE/DESTROYED/KILL/POSITION_REPORTED/POSITION_STALE，按 battle-relative 秒）。
     * POSITION_REPORTED/STALE 只表达回放 POV 观测覆盖变化（canonical AoI），不是点亮/失察。
     * 无法可靠解析身份的伤害/击毁不输出对应事件，绝不编造。
     */
    private static MapOverview.Playback buildPlayback(
            final Battle battle,
            final TeamEntityMapping mapping,
            final Positions positions,
            final List<ReplayEvent> events,
            final Float battleStartRawClockSec) {
        if (battle == null || battle.players == null || positions.isEmpty()) {
            return null;
        }
        // 时长契约：所有 playback 数据（event/interval/direction/deathSec）都必须落在 [0, durationSec]。
        final double duration = resolveDurationSec(battle, positions, events, battleStartRawClockSec);
        final Long recorderAccount = resolveRecorderAccountId(battle);
        // 战斗事实重建（§11–§17 共享推导，BattlePlaybackAdapter 同源）：权威 HP loss + 击毁
        final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result combat =
                com.wotb.core.replay.feature.PlaybackCombatReconstruction.derive(
                        events, mapping,
                        battleStartRawClockSec == null ? 0.0 : battleStartRawClockSec.doubleValue(),
                        duration);
        // §B9：结算缺失但回放已证明击毁（combat.destroyed）时，位置覆盖不得越过该击毁时刻（禁阵亡后残余位置）。
        // 与 BattlePlaybackAdapter 的 AoI-aware 停机口保持同源（此 map 用 raw 时钟域，与 Positions 一致）。
        final Map<Long, Double> destroyRawByAccount = new HashMap<>();
        for (final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Destroyed d : combat.destroyed()) {
            destroyRawByAccount.putIfAbsent(d.victimAccountId(), d.timeSec());
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
            final Double rawDeath = resolveDeathSec(player);
            final Double deathSec = rawDeath == null ? null : Math.min(rawDeath, duration);
            List<MapOverview.PositionInterval> intervals = positionIntervals(
                    entityIds, positions, events, battleStartRawClockSec, deathSec, duration);
            intervals = clampIntervalsToDestroyed(intervals, destroyRawByAccount.get(player.accountId));
            final List<MapOverview.DirectionSample> directionSamples = directionSamples(
                    entityIds, positions, events, battleStartRawClockSec, deathSec, intervals, duration);
            final List<MapOverview.HpSample> hpSamples = hpSamplesByAccount(
                    events, mapping, player.accountId, deathSec, duration, battleStartRawClockSec);
            vehicles.add(new MapOverview.PlaybackVehicle(
                    player.accountId, player.nickname, player.tankId,
                    ReplayDisplayNames.tankName(player.tankId, player.tankName), player.team,
                    intervals, deathSec, directionSamples,
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

        final List<MapOverview.PlaybackEvent> playbackEvents = new ArrayList<>();
        final java.util.Set<Long> destroyedVictims = new java.util.HashSet<>();
        for (final ReplayEvent event : events) {
            if (event instanceof DamageEvent damage) {
                final long victim = accountOf(damage.victimEid(), mapping);
                if (victim <= 0) {
                    continue;
                }
                final long attacker = accountOf(damage.attackerEid(), mapping);
                final double t = relativeSec(damage, battleStartRawClockSec);
                playbackEvents.add(new MapOverview.PlaybackEvent(
                        "DAMAGE", t,
                        attacker > 0 ? attacker : null, victim, damage.damage(),
                        com.wotb.core.replay.feature.PlaybackCombatReconstruction
                                .observedHpLossAt(combat, victim, t)));
            } else if (event instanceof VehicleDestroyedEvent destroyed) {
                final long victim = accountOf(destroyed.entityId(), mapping);
                if (victim <= 0) {
                    continue;
                }
                destroyedVictims.add(victim);
                playbackEvents.add(new MapOverview.PlaybackEvent(
                        "DESTROYED", relativeSec(destroyed, battleStartRawClockSec),
                        victim, null, null, null));
                final Integer killerEid = destroyed.killerEid();
                final long killer = killerEid != null ? accountOf(killerEid, mapping) : 0L;
                if (killer > 0 && killer != victim) {
                    playbackEvents.add(new MapOverview.PlaybackEvent(
                            "KILL", relativeSec(destroyed, battleStartRawClockSec),
                            killer, victim, null, null));
                }
            }
        }
        // 权威击毁推导（type-7 alive=false/HP=0）：不被显式 VehicleDestroyedEvent 覆盖的受害者
        for (final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Destroyed d
                : combat.destroyed()) {
            if (destroyedVictims.contains(d.victimAccountId())) {
                continue;
            }
            playbackEvents.add(new MapOverview.PlaybackEvent(
                    "DESTROYED", d.timeSec(), d.victimAccountId(), null, null, null));
            if (d.killerAccountId() != null && d.killerAccountId() != d.victimAccountId()) {
                playbackEvents.add(new MapOverview.PlaybackEvent(
                        "KILL", d.timeSec(), d.killerAccountId(), d.victimAccountId(), null, null));
            }
        }
        for (final MapOverview.PlaybackVehicle vehicle : vehicles) {
            if (recorderAccount != null && vehicle.accountId() == recorderAccount) {
                continue; // 录像者自身不做位置覆盖事件广播
            }
            for (final MapOverview.PositionInterval interval : vehicle.positionIntervals()) {
                playbackEvents.add(new MapOverview.PlaybackEvent(
                        "POSITION_REPORTED", interval.startSec(), vehicle.accountId(), null, null, null));
                playbackEvents.add(new MapOverview.PlaybackEvent(
                        "POSITION_STALE", interval.endSec(), vehicle.accountId(), null, null, null));
            }
        }
        // 时间契约兜底：非法/越界事件一律不进入 DTO（绝不因单个事件突破 duration）。
        playbackEvents.removeIf(e -> !Double.isFinite(e.timeSec())
                || e.timeSec() < 0 || e.timeSec() > duration + 1e-6);
        playbackEvents.sort(Comparator.comparingDouble(MapOverview.PlaybackEvent::timeSec));

        return new MapOverview.Playback(duration, vehicles, playbackEvents,
                pointsSamples(events, duration, battleStartRawClockSec));
    }

    /**
     * 车辆回放实测血量采样（battle-relative 秒升序）：过滤 type-7 propId=3 HealthChangedEvent
     * （EXACT 置信度），按实体→账号映射合并 re-entry，保留 [0, duration] 内样本（含阵亡到 0）。
     */
    private static List<MapOverview.HpSample> hpSamplesByAccount(
            final List<ReplayEvent> events,
            final TeamEntityMapping mapping,
            final long accountId,
            final Double deathSec,
            final double duration,
            final Float battleStartRawClockSec) {
        final List<MapOverview.HpSample> samples = new ArrayList<>();
        if (events == null) {
            return samples;
        }
        for (final ReplayEvent event : events) {
            if (!(event instanceof HealthChangedEvent hp)
                    || hp.confidence() != DecodeConfidence.EXACT
                    || hp.currentHealth() == null) {
                continue;
            }
            // signed i16 语义：仅保留真实正 HP 与阵亡 0；0xFFFD(-3)/0xFFFF(-1) 等 sentinel
            // 已被解码器置 null，此处再兜底——绝不允许 65533/65535 进入 hpSamples
            if (hp.currentHealth() != 0 && !HealthChangedEvent.isPlausibleHp(hp.currentHealth())) {
                continue;
            }
            if (accountOf(hp.entityId(), mapping) != accountId) {
                continue;
            }
            final double t = relativeSec(hp, battleStartRawClockSec);
            if (!Double.isFinite(t) || t < 0 || t > duration + 1e-6) {
                continue;
            }
            samples.add(new MapOverview.HpSample(t, hp.currentHealth()));
        }
        // PR147: destroyed = authoritative 0, same as the canonical adapter (terminal sentinel HP -> null
        // is dropped above); inject the 0 at deathSec so a destroyed vehicle always has a 0 sample.
        if (deathSec != null && deathSec >= 0 && deathSec <= duration + 1e-6
                && samples.stream().noneMatch(s -> s.hp() == 0)) {
            samples.add(new MapOverview.HpSample(deathSec, 0));
        }
        samples.sort(Comparator.comparingDouble(MapOverview.HpSample::timeSec));
        return samples;
    }

    /**
     * 争霸赛实时点数时间线（type-8 subtype48 root field12，PROVEN）：只消费回放真实广播，
     * 绝不按游戏规则推算；battle-relative 秒升序，仅保留 [0, duration] 内 EXACT 事件。
     */
    private static List<MapOverview.PointsSample> pointsSamples(
            final List<ReplayEvent> events,
            final double duration,
            final Float battleStartRawClockSec) {
        final List<MapOverview.PointsSample> samples = new ArrayList<>();
        if (events == null) {
            return samples;
        }
        for (final ReplayEvent event : events) {
            if (!(event instanceof SupremacyPointsChangedEvent points)
                    || points.confidence() != DecodeConfidence.EXACT) {
                continue;
            }
            final double t = relativeSec(points, battleStartRawClockSec);
            if (!Double.isFinite(t) || t < 0 || t > duration + 1e-6) {
                continue;
            }
            samples.add(new MapOverview.PointsSample(t, points.team(), points.points()));
        }
        samples.sort(Comparator.comparingDouble(MapOverview.PointsSample::timeSec));
        return samples;
    }

    /**
     * playback 时长（秒）：① finite 且 >0 的 battle.durationS；② 合法 battle-relative 的
     * BattleEndedEvent（取最早一个）；③ 位置流最后可信时刻；全无 → 0。
     */
    private static double resolveDurationSec(
            final Battle battle,
            final Positions positions,
            final List<ReplayEvent> events,
            final Float battleStartRawClockSec) {
        if (battle != null && battle.durationS != null
                && Double.isFinite(battle.durationS) && battle.durationS > 0) {
            return battle.durationS;
        }
        double battleEnd = Double.NaN;
        for (final ReplayEvent event : events) {
            if (event instanceof RoundFinishedEvent ended) {
                final double t = relativeSec(ended, battleStartRawClockSec);
                if (Double.isFinite(t) && t > 0) {
                    battleEnd = Double.isNaN(battleEnd) ? t : Math.min(battleEnd, t);
                }
            }
        }
        if (Double.isFinite(battleEnd) && battleEnd > 0) {
            return battleEnd;
        }
        return Math.max(0, positions.lastTimeSec());
    }

    /**
     * 车辆方向采样：type-7 propId=2（炮塔相对车体角）与同车 type-10 位置（hull yaw）配对。
     * <p>可信度边界：turret sample 的 t 必须落在该车同一可信 position-report 区间内，hull yaw 只能
     * 从该区间内的位置样本配对——位置流中断（gap）期间不得继续用后续 prop2 推动炮塔，不得跨 gap
     * 从另一侧取 hull yaw；re-entry 后新方向段才继续。</p>
     * <p>仅保留 finite、0 ≤ t ≤ min(duration, deathSec) 的样本；按「dt≥1s 或方向变化≥10°」降采样，
     * 每个可信方向段的最后一个样本恒保留（冻结准确）；无可靠方向的车辆返回空列表（不伪造朝向）。</p>
     */
    private static List<MapOverview.DirectionSample> directionSamples(
            final List<Integer> entityIds,
            final Positions positions,
            final List<ReplayEvent> events,
            final Float battleStartRawClockSec,
            final Double deathSec,
            final List<MapOverview.PositionInterval> intervals,
            final double duration) {
        final List<double[]> raw = new ArrayList<>();
        for (final int entityId : entityIds) {
            for (final ReplayEvent event : events) {
                if (!(event instanceof TurretDirectionChangedEvent turret)
                        || turret.entityId() != entityId) {
                    continue;
                }
                final double t = relativeSec(turret, battleStartRawClockSec);
                if (!Double.isFinite(t) || t < 0 || t > duration + 1e-6
                        || (deathSec != null && t > deathSec + 1e-6)) {
                    continue;
                }
                // t 必须位于该车某个可信位置上报区间内；hull yaw 只允许来自同一区间的位置样本。
                final MapOverview.PositionInterval interval = intervals.stream()
                        .filter(iv -> t >= iv.startSec() - 1e-6 && t <= iv.endSec() + 1e-6)
                        .findFirst().orElse(null);
                if (interval == null) {
                    continue;
                }
                final Position pos = nearestWithin(entityIds, positions, t,
                        interval.startSec(), interval.endSec());
                if (pos == null || pos.yawDeg() == null || !Double.isFinite(pos.yawDeg())) {
                    continue;
                }
                raw.add(new double[]{t, pos.yawDeg(), turret.turretRelativeYawDeg()});
            }
        }
        raw.sort(Comparator.comparingDouble(a -> a[0]));
        final List<MapOverview.DirectionSample> out = new ArrayList<>();
        double lastKeptT = Double.NEGATIVE_INFINITY;
        double lastHull = 0;
        double lastRel = 0;
        for (final double[] s : raw) {
            final boolean first = out.isEmpty();
            final double dHull = first ? 0 : shortestArcDeg(s[1], lastHull);
            final double dRel = first ? 0 : shortestArcDeg(s[2], lastRel);
            if (first || s[0] - lastKeptT >= 1.0
                    || Math.abs(dHull) >= 10.0 || Math.abs(dRel) >= 10.0) {
                out.add(new MapOverview.DirectionSample(s[0], s[1], s[2]));
                lastKeptT = s[0];
                lastHull = s[1];
                lastRel = s[2];
            } else {
                // 未保留：更新基准，避免漂移累积误判变化阈值
                lastHull = s[1];
                lastRel = s[2];
            }
        }
        // 段末冻结保证：最后一个可信样本即使未跨阈值也恒保留（当前实现与注释一致）。
        if (!raw.isEmpty()
                && (out.isEmpty()
                || raw.get(raw.size() - 1)[0] > out.get(out.size() - 1).timeSec() + 1e-6)) {
            final double[] lastRaw = raw.get(raw.size() - 1);
            out.add(new MapOverview.DirectionSample(lastRaw[0], lastRaw[1], lastRaw[2]));
        }
        return out;
    }

    /** 在 [startSec, endSec] 区间内找时间上最接近 t 的位置（跨实体合并；禁止区间外配对）。 */
    private static Position nearestWithin(
            final List<Integer> entityIds,
            final Positions positions,
            final double t,
            final double startSec,
            final double endSec) {
        Position best = null;
        double bestDelta = Double.MAX_VALUE;
        for (final int entityId : entityIds) {
            for (final Position pos : positions.byEntity().getOrDefault(entityId, List.of())) {
                if (pos.timeSec < startSec - 1e-6 || pos.timeSec > endSec + 1e-6) {
                    continue;
                }
                final double delta = Math.abs(pos.timeSec - t);
                if (delta < bestDelta) {
                    bestDelta = delta;
                    best = pos;
                }
            }
        }
        return best;
    }

    /** 最短圆弧差（度，[-180,180]）。 */
    private static double shortestArcDeg(final double a, final double b) {
        double d = (a - b) % 360.0;
        if (d > 180) {
            d -= 360;
        }
        if (d < -180) {
            d += 360;
        }
        return d;
    }

    /**
     * 车辆位置上报区间 = canonical AoI observed segment（{@link ReplayAoiLifecycle}）
     * ∩ 实际位置存在范围，再经 deathSec / duration clamp。同一 open segment 内<b>不再</b>
     * 做 5 秒 packet-gap splitting（静止车辆即使 &gt;5s 无 Type10 也不产生 POSITION_STALE）
     * ——与 {@link BattlePlaybackAdapter} 同源（{@link AoiPositionCoverage}）。段段之间
     * （UNKNOWN_AOI gap）不产生区间。
     */
    static List<MapOverview.PositionInterval> positionIntervals(
            final List<Integer> entityIds,
            final Positions positions,
            final List<ReplayEvent> events,
            final Float battleStartRawClockSec,
            final Double deathSec,
            final double duration) {
        final List<com.wotb.core.replay.facts.AoiObservationSegment> aoiSegments =
                com.wotb.core.replay.facts.ReplayAoiLifecycle.build(
                        events, battleStartRawClockSec == null
                                ? null : battleStartRawClockSec.doubleValue());
        // §P1-1: 按 entityId 保留位置 provenance（每实体独立升序），段只与同 entity 的样本相交，
        // 防止 re-entry 多 entity 时另一实体的 position 替本实体证明覆盖。
        final Map<Integer, List<Double>> positionTimesByEntity = new LinkedHashMap<>();
        for (final int entityId : entityIds) {
            final List<Double> times = new ArrayList<>();
            for (final Position p : positions.byEntity().getOrDefault(entityId, List.of())) {
                times.add(p.timeSec);
            }
            times.sort(Comparator.naturalOrder());
            positionTimesByEntity.put(entityId, times);
        }
        return AoiPositionCoverage.intervals(aoiSegments, entityIds, positionTimesByEntity, deathSec, duration);
    }


    /**
     * §B9：把位置上报区间按「权威击毁时刻」收口——击毁后的区间整体剔除、跨越击毁的区间末端 clamp，
     * 避免回放显示阵亡后的残余服务器位置。destroyRaw == null 时原样返回（未经击毁）。
     */
    private static List<MapOverview.PositionInterval> clampIntervalsToDestroyed(
            final List<MapOverview.PositionInterval> intervals, final Double destroyRaw) {
        if (destroyRaw == null || intervals == null || intervals.isEmpty()) {
            return intervals;
        }
        final List<MapOverview.PositionInterval> out = new ArrayList<>();
        for (final MapOverview.PositionInterval it : intervals) {
            if (it.startSec() > destroyRaw + 1e-6) {
                continue;
            }
            final double end = Math.min(it.endSec(), destroyRaw);
            if (end >= it.startSec() - 1e-6) {
                out.add(new MapOverview.PositionInterval(it.startSec(), Math.max(it.startSec(), end)));
            }
        }
        return out;
    }
    private static long accountOf(final int entityId, final TeamEntityMapping mapping) {
        if (entityId <= 0) {
            return 0L;
        }
        final TeamEntityIdentity identity = mapping.identity(entityId);
        return identity != null ? identity.accountId() : 0L;
    }

    /** 录像者账号 id（Battle.recorder 昵称已在 ReplayParser 解析时归一化，可稳定匹配 players）；未解析为 null。 */
    private static Long resolveRecorderAccountId(final Battle battle) {
        final PlayerResult recorder = battle.recorderResult();
        return recorder != null && recorder.accountId > 0 ? recorder.accountId : null;
    }

    /** 整场最终战绩（结算口径；仅供「最终战绩」分区，不得冒充当前时间点状态）。 */
    private static MapOverview.FinalStats finalStats(final PlayerResult p) {
        return new MapOverview.FinalStats(
                p.damageDealt, p.damageReceived, p.damageAssisted, p.kills,
                p.nShots, p.nHitsDealt, p.nPenetrationsDealt,
                p.nHitsReceived, p.nPenetrationsReceived, p.damageBlocked);
    }

    private static Integer resolveFriendlyTeam(
            final Battle battle,
            final ReplayReconstruction reconstruction
    ) {
        if (battle.recorder != null && !battle.recorder.isBlank()) {
            for (final PlayerResult p : battle.players) {
                if (battle.recorder.equals(p.nickname) && p.team > 0) {
                    return p.team;
                }
            }
        }
        try {
            final TeamPerspectiveResolution perspective =
                    TeamPerspectiveResolver.resolve(battle, reconstruction);
            if (perspective != null && perspective.resolved()) {
                return perspective.perspectiveTeam();
            }
        } catch (final RuntimeException ignored) {
            // 视角解析失败视为未解析
        }
        return null;
    }

    private static List<MapOverview.Route> buildRoutes(
            final Battle battle,
            final TeamEntityMapping mapping,
            final Positions positions,
            final int friendlyTeam,
            final MapGridProfile profile
    ) {
        final List<MapOverview.Route> routes = new ArrayList<>();
        final double duration = battle.durationS != null && battle.durationS > 0
                ? battle.durationS : 0;
        for (final PlayerResult player : battle.players) {
            if (player.team <= 0 || player.accountId <= 0) {
                continue;
            }
            final List<Integer> entityIds = mapping.entityIdsByAccount()
                    .getOrDefault(player.accountId, List.of());
            final List<Position> timeline = new ArrayList<>();
            for (final int eid : entityIds) {
                timeline.addAll(positions.byEntity().getOrDefault(eid, List.of()));
            }
            if (timeline.isEmpty()) {
                continue;
            }
            timeline.sort(Comparator.comparingDouble(Position::timeSec));
            final Position first = timeline.get(0);
            final Position last = timeline.get(timeline.size() - 1);
            final double interval = duration > 0 ? Math.max(2.0, duration / 200.0) : 2.0;
            final List<MapOverview.Point> points = new ArrayList<>();
            double nextSample = first.timeSec;
            for (final Position pos : timeline) {
                if (pos.timeSec >= nextSample - 1e-6) {
                    points.add(new MapOverview.Point(pos.x, pos.z, pos.timeSec));
                    nextSample = pos.timeSec + interval;
                }
            }
            if (points.isEmpty() || points.get(points.size() - 1).timeSec() < last.timeSec - 1e-6) {
                points.add(new MapOverview.Point(last.x, last.z, last.timeSec));
            }
            final Double deathSec = resolveDeathSec(player);
            routes.add(new MapOverview.Route(
                    player.accountId,
                    player.nickname,
                    player.tankId,
                    player.team,
                    points,
                    first.timeSec,
                    last.timeSec,
                    deathSec));
        }
        return routes;
    }

    private static MapOverview.Heatmaps buildHeatmaps(
            final Battle battle,
            final TeamEntityMapping mapping,
            final Positions positions,
            final List<DamageEvent> damages,
            final int friendlyTeam,
            final MapGridProfile profile,
            final Float battleStartRawClockSec,
            final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result combat
    ) {
        final int cells = profile.gridCells().size();
        final double[] friendlyDwell = new double[cells];
        final double[] enemyDwell = new double[cells];
        final double[] friendlyDamage = new double[cells];
        final double[] enemyDamage = new double[cells];
        final double[] friendlyDeaths = new double[cells];
        final double[] enemyDeaths = new double[cells];

        for (final Map.Entry<Integer, TeamEntityIdentity> e : mapping.entitiesById().entrySet()) {
            final TeamEntityIdentity identity = e.getValue();
            if (!identity.usable() || identity.team() <= 0) {
                continue;
            }
            final boolean friendly = identity.team() == friendlyTeam;
            final double[] dwell = friendly ? friendlyDwell : enemyDwell;
            for (final Position pos : positions.byEntity().getOrDefault(e.getKey(), List.of())) {
                final MapGridProfile.GridCell cell = profile.cellAt(pos.x, pos.z);
                if (cell != null) {
                    dwell[profile.gridCells().indexOf(cell)]++;
                }
            }
        }

        // 伤害热力按受击方位置落格（§12）：值 = 权威 HP loss（Type-7 推导，含无法归属的掉血——
        // 掉血真实发生在 victim 身上，热力按 victim 位置刻画实际承受的伤害）；
        // Type-8 rawProtocolValue 语义未证明，不得进热力。
        for (final Map.Entry<Long, List<com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss>> entry
                : combat.lossesByVictim().entrySet()) {
            final List<Integer> entityIds = mapping.entityIdsByAccount()
                    .getOrDefault(entry.getKey(), List.of());
            if (entityIds.isEmpty()) {
                continue;
            }
            final Integer victimTeam = teamOfEntityIds(entityIds, mapping);
            if (victimTeam == null || victimTeam <= 0) {
                continue;
            }
            final double[] damageArr = victimTeam == friendlyTeam ? friendlyDamage : enemyDamage;
            for (final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss loss
                    : entry.getValue()) {
                final Position pos = nearestPosition(entityIds, positions, loss.toSec());
                if (pos == null) {
                    continue;
                }
                final MapGridProfile.GridCell cell = profile.cellAt(pos.x, pos.z);
                if (cell == null) {
                    continue;
                }
                damageArr[profile.gridCells().indexOf(cell)] += loss.hpLoss();
            }
        }

        final Map<Long, Double> deathSecByAccount = new HashMap<>();
        for (final PlayerResult player : battle.players) {
            final Double deathSec = resolveDeathSec(player);
            if (deathSec != null) {
                deathSecByAccount.put(player.accountId, deathSec);
            }
        }
        for (final Map.Entry<Long, Double> entry : deathSecByAccount.entrySet()) {
            final List<Integer> entityIds = mapping.entityIdsByAccount()
                    .getOrDefault(entry.getKey(), List.of());
            Position deathPos = null;
            for (final int eid : entityIds) {
                final Position p = positions.lastBefore(eid, entry.getValue());
                if (p != null && (deathPos == null || p.timeSec > deathPos.timeSec)) {
                    deathPos = p;
                }
            }
            if (deathPos == null) {
                continue;
            }
            final TeamEntityIdentity identity = mapping.entitiesById()
                    .get(positions.entityForLatest(deathPos, entityIds));
            if (identity == null || identity.team() <= 0) {
                continue;
            }
            final MapGridProfile.GridCell cell = profile.cellAt(deathPos.x, deathPos.z);
            if (cell == null) {
                continue;
            }
            final double[] deaths = identity.team() == friendlyTeam ? friendlyDeaths : enemyDeaths;
            deaths[profile.gridCells().indexOf(cell)]++;
        }

        return new MapOverview.Heatmaps(
                new MapOverview.Layer(toList(friendlyDwell), toList(friendlyDamage), toList(friendlyDeaths)),
                new MapOverview.Layer(toList(enemyDwell), toList(enemyDamage), toList(enemyDeaths)));
    }

    private static List<MapOverview.Phase> buildPhases(
            final List<DamageEvent> damages,
            final Positions positions,
            final Battle battle,
            final Float battleStartRawClockSec
    ) {
        float firstContact = -1f;
        for (final DamageEvent damage : damages) {
            final float t = (float) relativeSec(damage, battleStartRawClockSec);
            if (Float.isFinite(t) && t >= 0 && (firstContact < 0 || t < firstContact)) {
                firstContact = t;
            }
        }
        final float battleEnd;
        if (battle.durationS != null && battle.durationS > 0) {
            battleEnd = battle.durationS.floatValue();
        } else {
            battleEnd = positions.lastTimeSec();
        }
        if (!Float.isFinite(battleEnd) || battleEnd <= 0) {
            return List.of();
        }
        final List<BattlePhaseSummary> raw = BattlePhaseSummary.buildRelativePhases(
                firstContact, battleEnd);
        if (raw.isEmpty()) {
            return List.of();
        }
        float openingEnd = raw.get(0).endTime();
        for (final BattlePhaseSummary phase : raw) {
            if (phase.type() == com.wotb.core.replay.feature.BattlePhaseType.FIRST_CONTACT) {
                openingEnd = Math.max(openingEnd, phase.endTime());
            }
        }
        final float lateStart = Math.max(openingEnd, battleEnd
                - BattlePhaseSummary.DENSE_KILL_WINDOW_SEC);
        final List<MapOverview.Phase> phases = new ArrayList<>();
        phases.add(new MapOverview.Phase("opening", 0.0, openingEnd));
        if (lateStart > openingEnd + 1e-3) {
            phases.add(new MapOverview.Phase("mid", openingEnd, lateStart));
        }
        phases.add(new MapOverview.Phase("late", lateStart, battleEnd));
        return phases;
    }

    /** 账号 → 阵营（任一已解析实体）；无 → null。 */
    private static Integer teamOfEntityIds(final List<Integer> entityIds,
                                           final TeamEntityMapping mapping) {
        for (final int eid : entityIds) {
            final TeamEntityIdentity identity = mapping.identity(eid);
            if (identity != null && identity.team() > 0) {
                return identity.team();
            }
        }
        return null;
    }

    /** 账号在 t 时刻最近可信位置（跨实体 re-entry 取最近）。 */
    private static Position nearestPosition(final List<Integer> entityIds,
                                            final Positions positions, final double t) {
        Position best = null;
        for (final int eid : entityIds) {
            final Position p = positions.nearest(eid, t);
            if (p == null) {
                continue;
            }
            if (best == null || Math.abs(p.timeSec - t) < Math.abs(best.timeSec - t)) {
                best = p;
            }
        }
        return best;
    }

    private static List<Double> toList(final double[] values) {
        final List<Double> out = new ArrayList<>(values.length);
        for (final double v : values) {
            out.add(v);
        }
        return out;
    }

    private static Map<String, String> displayNames(final String mapCode, final String fallbackEn) {
        final MapNames.Localized names = MapNames.localized(mapCode);
        final String en = names.en() != null && !names.en().isBlank() ? names.en() : fallbackEn;
        final Map<String, String> out = new LinkedHashMap<>();
        out.put("zh", names.zh() != null && !names.zh().isBlank() ? names.zh() : en);
        out.put("en", en);
        out.put("ru", names.ru() != null && !names.ru().isBlank() ? names.ru() : en);
        return out;
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

    /** 阵亡时刻（battle-relative 秒）：仅未存活玩家；优先结算，回退事件流估算；未知为 null。 */
    private static Double resolveDeathSec(final PlayerResult player) {
        if (player.survived) {
            return null;
        }
        final double deathSec = PlayerResultFormat.deathSec(player);
        return deathSec > 0 ? deathSec : null;
    }

    private static double relativeSec(final ReplayEvent event, final Float battleStartRawClockSec) {
        if (event.timestamp() == null) {
            return 0;
        }
        final Float battle = event.timestamp().battleClockSec();
        if (battle != null) {
            return battle;
        }
        if (battleStartRawClockSec != null && Float.isFinite(battleStartRawClockSec)) {
            return event.timestamp().rawClockSec() - battleStartRawClockSec;
        }
        return event.timestamp().rawClockSec();
    }

    /**
     * 某时刻的平面位置（语义坐标 x/z 与 battle-relative 秒）。
     * yawDeg 来自 type-10 yaw（弧度→度，[-180,180)），非有限时为 null（不参与方向采样）。
     */
    record Position(double timeSec, double x, double z, Double yawDeg) {
    }

    /** 按实体聚合的位置时间线（有序），附带最近/最后位置查询。 */
    static final class Positions {

        private final Map<Integer, List<Position>> byEntity;
        private float lastTimeSec;

        Positions(final Map<Integer, List<Position>> byEntity) {
            this.byEntity = byEntity;
            this.lastTimeSec = 0f;
            for (final List<Position> list : byEntity.values()) {
                if (!list.isEmpty()) {
                    lastTimeSec = Math.max(lastTimeSec, (float) list.get(list.size() - 1).timeSec);
                }
            }
        }

        static Positions collect(
                final List<ReplayEvent> events,
                final TeamEntityMapping mapping,
                final Float battleStartRawClockSec
        ) {
            final Map<Integer, List<Position>> byEntity = new LinkedHashMap<>();
            for (final ReplayEvent event : events) {
                if (!(event instanceof PositionChangedEvent pos)
                        || !mapping.entitiesById().containsKey(pos.entityId())) {
                    continue;
                }
                if (!Float.isFinite(pos.x()) || !Float.isFinite(pos.z())) {
                    continue;
                }
                final double t = relativeSec(pos, battleStartRawClockSec);
                if (!Double.isFinite(t) || t < 0) {
                    continue;
                }
                final Double yawDeg = Float.isFinite(pos.yaw())
                        ? Math.toDegrees(pos.yaw()) : null;
                byEntity.computeIfAbsent(pos.entityId(), k -> new ArrayList<>())
                        .add(new Position(t, pos.x(), pos.z(), yawDeg));
            }
            byEntity.values().forEach(list -> list.sort(Comparator.comparingDouble(Position::timeSec)));
            return new Positions(byEntity);
        }

        boolean isEmpty() {
            return byEntity.isEmpty();
        }

        Map<Integer, List<Position>> byEntity() {
            return byEntity;
        }

        float lastTimeSec() {
            return lastTimeSec;
        }

        /** 时间上最接近 t 的位置（|Δt| ≤ 3s 才返回，避免张冠李戴）。 */
        Position nearest(final int entityId, final double t) {
            final List<Position> list = byEntity.getOrDefault(entityId, List.of());
            Position best = null;
            double bestDelta = Double.MAX_VALUE;
            for (final Position pos : list) {
                final double delta = Math.abs(pos.timeSec - t);
                if (delta < bestDelta) {
                    bestDelta = delta;
                    best = pos;
                }
            }
            return best != null && bestDelta <= 3.0 ? best : null;
        }

        /** 时间 ≤ t 的最后一个位置。 */
        Position lastBefore(final int entityId, final double t) {
            final List<Position> list = byEntity.getOrDefault(entityId, List.of());
            Position result = null;
            for (final Position pos : list) {
                if (pos.timeSec <= t) {
                    result = pos;
                } else {
                    break;
                }
            }
            return result;
        }

        /** 返回在给定实体集合中拥有该位置时刻的实体 id（用于死亡落格时的身份回查）。 */
        int entityForLatest(final Position deathPos, final List<Integer> entityIds) {
            for (final int eid : entityIds) {
                final List<Position> list = byEntity.getOrDefault(eid, List.of());
                for (final Position pos : list) {
                    if (pos == deathPos) {
                        return eid;
                    }
                }
            }
            return -1;
        }
    }
}
