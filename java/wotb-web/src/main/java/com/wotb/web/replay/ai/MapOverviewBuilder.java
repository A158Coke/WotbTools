package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.MapNames;
import com.wotb.core.processing.TeamEntityIdentity;
import com.wotb.core.processing.TeamEntityMapper;
import com.wotb.core.processing.TeamEntityMapping;
import com.wotb.core.processing.TeamPerspectiveResolution;
import com.wotb.core.processing.TeamPerspectiveResolver;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.EntityRemovedEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.TurretDirectionChangedEvent;
import com.wotb.core.replay.event.VehicleDestroyedEvent;
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
        final MapOverview.Heatmaps heatmaps = buildHeatmaps(
                battle, mapping, positions, damages, friendlyTeam, profile, battleStart);
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
     * 位置流连续上报的最大间隔（秒）；超过则视为位置上报中断，重新出现时新开区间。
     * 语义 = 服务器位置流覆盖，不等于「对录像者可见/点亮」（type-10 与点亮无关）。
     */
    private static final double POSITION_GAP_SEC = 5.0;

    /**
     * 战局回放数据：车辆（位置复用路线点，这里只补充位置上报区间）+
     * 时间轴事件（DAMAGE/DESTROYED/KILL/POSITION_REPORTED/POSITION_STALE，按 battle-relative 秒）。
     * POSITION_REPORTED/STALE 只表达服务器位置流覆盖变化，不是点亮/失察（见 POSITION_GAP_SEC）。
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
        final Long recorderAccount = resolveRecorderAccountId(battle);
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
            final Double deathSec = resolveDeathSec(player);
            final List<MapOverview.PositionInterval> intervals = positionIntervals(
                    entityIds, positions, events, battleStartRawClockSec, deathSec);
            final List<MapOverview.DirectionSample> directionSamples = directionSamples(
                    entityIds, positions, events, battleStartRawClockSec, deathSec);
            vehicles.add(new MapOverview.PlaybackVehicle(
                    player.accountId, player.nickname, player.tankId,
                    player.tankName == null ? "" : player.tankName, player.team,
                    intervals, deathSec, directionSamples));
        }
        if (vehicles.isEmpty()) {
            return null;
        }

        final List<MapOverview.PlaybackEvent> playbackEvents = new ArrayList<>();
        for (final ReplayEvent event : events) {
            if (event instanceof DamageEvent damage) {
                final long victim = accountOf(damage.victimEid(), mapping);
                if (victim <= 0) {
                    continue;
                }
                final long attacker = accountOf(damage.attackerEid(), mapping);
                playbackEvents.add(new MapOverview.PlaybackEvent(
                        "DAMAGE", relativeSec(damage, battleStartRawClockSec),
                        attacker > 0 ? attacker : null, victim, damage.damage()));
            } else if (event instanceof VehicleDestroyedEvent destroyed) {
                final long victim = accountOf(destroyed.entityId(), mapping);
                if (victim <= 0) {
                    continue;
                }
                playbackEvents.add(new MapOverview.PlaybackEvent(
                        "DESTROYED", relativeSec(destroyed, battleStartRawClockSec),
                        victim, null, null));
                final Integer killerEid = destroyed.killerEid();
                final long killer = killerEid != null ? accountOf(killerEid, mapping) : 0L;
                if (killer > 0 && killer != victim) {
                    playbackEvents.add(new MapOverview.PlaybackEvent(
                            "KILL", relativeSec(destroyed, battleStartRawClockSec),
                            killer, victim, null));
                }
            }
        }
        for (final MapOverview.PlaybackVehicle vehicle : vehicles) {
            if (recorderAccount != null && vehicle.accountId() == recorderAccount) {
                continue; // 录像者自身不做位置覆盖事件广播
            }
            for (final MapOverview.PositionInterval interval : vehicle.positionIntervals()) {
                playbackEvents.add(new MapOverview.PlaybackEvent(
                        "POSITION_REPORTED", interval.startSec(), vehicle.accountId(), null, null));
                playbackEvents.add(new MapOverview.PlaybackEvent(
                        "POSITION_STALE", interval.endSec(), vehicle.accountId(), null, null));
            }
        }
        playbackEvents.sort(Comparator.comparingDouble(MapOverview.PlaybackEvent::timeSec));

        final double duration = battle.durationS != null && battle.durationS > 0
                ? battle.durationS : positions.lastTimeSec();
        return new MapOverview.Playback(
                duration > 0 ? duration : 0, vehicles, playbackEvents);
    }

    /**
     * 车辆方向采样：type-7 propId=2（炮塔相对车体角）与同车最近 type-10 位置（hull yaw）配对。
     * 仅保留 finite、≥0、≤deathSec 的样本；按「dt≥1s 或方向变化≥10°」降采样以控制载荷，
     * 首尾样本恒保留；无可靠炮塔/车体方向的车辆返回空列表（不伪造朝向）。
     */
    private static List<MapOverview.DirectionSample> directionSamples(
            final List<Integer> entityIds,
            final Positions positions,
            final List<ReplayEvent> events,
            final Float battleStartRawClockSec,
            final Double deathSec) {
        final List<double[]> raw = new ArrayList<>();
        for (final int entityId : entityIds) {
            for (final ReplayEvent event : events) {
                if (!(event instanceof TurretDirectionChangedEvent turret)
                        || turret.entityId() != entityId) {
                    continue;
                }
                final double t = relativeSec(turret, battleStartRawClockSec);
                if (!Double.isFinite(t) || t < 0
                        || (deathSec != null && t > deathSec + 1e-6)) {
                    continue;
                }
                final Position pos = positions.nearest(entityId, t);
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
        return out;
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
     * 车辆位置上报区间：按位置事件时间线聚类（gap ≤ 5s 视为连续上报），
     * EntityRemoved 关闭末段区间，阵亡时刻截断区间末端；re-entry 跨实体区间合并。
     * 语义 = 服务器位置流覆盖，不代表录像者点亮。
     */
    private static List<MapOverview.PositionInterval> positionIntervals(
            final List<Integer> entityIds,
            final Positions positions,
            final List<ReplayEvent> events,
            final Float battleStartRawClockSec,
            final Double deathSec) {
        final List<MapOverview.PositionInterval> raw = new ArrayList<>();
        for (final int entityId : entityIds) {
            final List<Position> pts = positions.byEntity().getOrDefault(entityId, List.of());
            if (pts.isEmpty()) {
                continue;
            }
            double removedAt = Double.MAX_VALUE;
            for (final ReplayEvent event : events) {
                if (event instanceof EntityRemovedEvent removed && removed.entityId() == entityId) {
                    removedAt = Math.min(removedAt, relativeSec(removed, battleStartRawClockSec));
                }
            }
            double runStart = pts.get(0).timeSec;
            double runEnd = runStart;
            for (int i = 1; i < pts.size(); i++) {
                final double t = pts.get(i).timeSec;
                if (t - runEnd > POSITION_GAP_SEC) {
                    raw.add(new MapOverview.PositionInterval(runStart, runEnd));
                    runStart = t;
                }
                runEnd = t;
            }
            final double intervalEnd = removedAt < runEnd
                    ? removedAt : runEnd;
            raw.add(new MapOverview.PositionInterval(runStart, intervalEnd));
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
        if (deathSec != null) {
            for (int i = 0; i < merged.size(); i++) {
                final MapOverview.PositionInterval interval = merged.get(i);
                if (interval.endSec() > deathSec) {
                    merged.set(i, new MapOverview.PositionInterval(
                            interval.startSec(), Math.max(interval.startSec(), deathSec)));
                }
            }
        }
        return merged;
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
            final Float battleStartRawClockSec
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

        for (final DamageEvent damage : damages) {
            final TeamEntityIdentity victim = mapping.entitiesById().get(damage.victimEid());
            if (victim == null || !victim.usable() || victim.team() <= 0) {
                continue;
            }
            final Position pos = positions.nearest(
                    damage.victimEid(), relativeSec(damage, battleStartRawClockSec));
            if (pos == null) {
                continue;
            }
            final MapGridProfile.GridCell cell = profile.cellAt(pos.x, pos.z);
            if (cell == null) {
                continue;
            }
            final double[] damageArr = victim.team() == friendlyTeam ? friendlyDamage : enemyDamage;
            damageArr[profile.gridCells().indexOf(cell)] += damage.damage();
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
    private record Position(double timeSec, double x, double z, Double yawDeg) {
    }

    /** 按实体聚合的位置时间线（有序），附带最近/最后位置查询。 */
    private static final class Positions {

        private final Map<Integer, List<Position>> byEntity;
        private float lastTimeSec;

        private Positions(final Map<Integer, List<Position>> byEntity) {
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
