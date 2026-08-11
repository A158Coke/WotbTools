package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.TeamEntityIdentity;
import com.wotb.core.processing.TeamEntityMapper;
import com.wotb.core.processing.TeamEntityMapping;
import com.wotb.core.processing.TeamPerspectiveResolution;
import com.wotb.core.processing.TeamPerspectiveResolver;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.feature.BattlePhaseSummary;
import com.wotb.core.replay.map.MapGridProfile;
import com.wotb.core.replay.map.MapGridRegistry;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.web.replay.dto.MapImageCatalog;
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

        return new MapOverview(
                battle.mapName.trim().toLowerCase(),
                profile.displayName(),
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
                MapImageCatalog.imageFor(profile.mapCode()),
                profile.spawnPoints().stream()
                        .map(s -> new MapOverview.SpawnPoint(s.name(), s.team(), s.x(), s.y()))
                        .toList(),
                phases,
                heatmaps,
                routes);
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
            final Double deathSec = player.deathTimeMillis > 0
                    ? player.deathTimeMillis / 1000.0 : null;
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
            if (player.deathTimeMillis > 0) {
                deathSecByAccount.put(player.accountId, player.deathTimeMillis / 1000.0);
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

    /** 某时刻的平面位置（语义坐标 x/z 与 battle-relative 秒）。 */
    private record Position(double timeSec, double x, double z) {
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
                byEntity.computeIfAbsent(pos.entityId(), k -> new ArrayList<>())
                        .add(new Position(t, pos.x(), pos.z()));
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
