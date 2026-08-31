package com.wotb.core.replay.timeline;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.ref.ReplayDisplayNames;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.RoundFinishedEvent;
import com.wotb.core.replay.facts.AoiObservationSegment;
import com.wotb.core.replay.facts.ReplayAoiLifecycle;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.LifeState;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.Vector3;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Canonical BattleTimeline 构建器。
 * <p>数据流：ReplayEvent → BattleStateReconstructor → BattleTimelineBuilder → BattleTimeline。
 * Timeline 一律 battle-relative 时间（docs/architecture/battle-timeline.md §2.3/§2.4）；时钟无法可靠建立时
 * Timeline = INVALID，该 replay 不进入 AI Review（禁止 settlement-only fallback）。</p>
 * <p>Anti-future-leak invariant：任意 frame second=N 的状态只使用 battle-relative
 * time ≤ N 的事件信息，绝不使用未来信息（含 battle_results 最终状态）。</p>
 * <p>ActualCombatantEntitySet 边界：tactical FrameVehicle universe 只包含可靠映射到
 * battle_results #301（battle.players）actual combatant 账号的实体；non-#301
 * spectator/camera/observer/场景静态实体即使被 broad roster / ParticipantMapping 赋予完整身份
 * （accountId/team/nickname/坦克元数据），也不得进入 FrameVehicle —— 因此不会产生
 * FIRST_KNOWN / ENEMY_LOST / ENEMY_REACQUIRED / POSITION_CHANGE / REGION_CHANGE / DESTROYED
 * 等 tactical deltas（spectator ≠ combatant；#301 是权威边界）。
 * raw timeline.events 保留原始事件供必要协议用途。</p>
 */
public final class BattleTimelineBuilder {

    /** 位置显著变化阈值（canonical 米）。 */
    static final double POSITION_CHANGE_THRESHOLD_M = 5.0;
    /** 防御性帧数上限（450s 战斗约 451 帧；超长异常拒绝而非 OOM）。 */
    static final int MAX_FRAMES = 2400;

    private BattleTimelineBuilder() {
    }

    /**
     * 构建 canonical timeline。validation 失败时返回 timeline=null + 错误码（调用方据此拒绝 AI Review）。
     */
    public static BattleTimelineResult build(
            final Battle battle,
            final ReplayReconstruction recon,
            final TimelinePerspective perspective) {

        final BattleTimelineValidationResult validation = validate(battle, recon, perspective);
        if (!validation.valid()) {
            return new BattleTimelineResult(null, validation);
        }

        final ClockResult clock = resolveClock(battle, recon);
        if (clock.resolution() == BattleTimelineClock.UNRESOLVED) {
            return new BattleTimelineResult(null, BattleTimelineValidationResult.invalid(
                    TimelineError.TIMELINE_CLOCK_UNRESOLVED,
                    "battle-relative clock could not be resolved (no battle start (wrapper3 BATTLE), no RoundFinishedEvent (method4), no duration)"));
        }

        final double duration = resolveDurationSec(battle, recon, clock.startRawClockSec());
        if (!(duration > 0) || !Double.isFinite(duration)) {
            return new BattleTimelineResult(null, BattleTimelineValidationResult.invalid(
                    TimelineError.TIMELINE_META_INVALID, "battle duration unusable"));
        }
        final int maxSecond = (int) Math.ceil(duration);
        if (maxSecond > MAX_FRAMES) {
            return new BattleTimelineResult(null, BattleTimelineValidationResult.invalid(
                    TimelineError.TIMELINE_META_INVALID,
                    "battle duration exceeds frame cap: " + maxSecond + "s"));
        }

        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
        if (mapping.entitiesById().isEmpty()) {
            return new BattleTimelineResult(null, BattleTimelineValidationResult.invalid(
                    TimelineError.TIMELINE_MAPPING_INSUFFICIENT,
                    "no entity→account mapping could be established"));
        }

        // ActualCombatantEntitySet（#301 权威边界）：只允许可靠映射到 battle.players
        // （battle_results #301 actual combatant）账号的实体进入 tactical FrameVehicle universe。
        // 即使 broad roster / ParticipantMapping 给 non-#301 实体提供完整身份，spectator 仍不得
        // 形成 tactical vehicle delta（杜绝 team=null 被 BattleDeltaEngine 当作 enemy）。
        final Set<Long> actualCombatantAccounts = actualCombatantAccounts(battle);
        final Set<Integer> actualCombatantEntityIds =
                mapping.actualCombatantEntityIds(actualCombatantAccounts);
        if (actualCombatantEntityIds.isEmpty()) {
            return new BattleTimelineResult(null, BattleTimelineValidationResult.invalid(
                    TimelineError.TIMELINE_MAPPING_INSUFFICIENT,
                    "no entity maps to a #301 actual combatant account"));
        }

        final EntityIndex index = EntityIndex.collect(recon.events(), clock.startRawClockSec());
        if (index.positions().isEmpty()) {
            return new BattleTimelineResult(null, BattleTimelineValidationResult.invalid(
                    TimelineError.TIMELINE_POSITION_COVERAGE_INSUFFICIENT,
                    "no position events available to build a tactical timeline"));
        }

        final int perspectiveTeam = perspective.perspectiveTeam() != null
                ? perspective.perspectiveTeam() : 0;
        final List<String> limitations = new ArrayList<>(mapping.limitations());
        if (clock.resolution() == BattleTimelineClock.ESTIMATED) {
            limitations.add("CLOCK_ESTIMATED");
        }
        if (TimelineClock.hasMixedClockDomains(recon.events())) {
            limitations.add("MIXED_CLOCK_DOMAINS");
        }
        if (index.invalidTimestampEvents() > 0) {
            limitations.add("INVALID_TIMESTAMP_EVENTS=" + index.invalidTimestampEvents());
        }

        final List<ReplayEvent> orderedEvents = orderedEvents(recon.events(), clock.startRawClockSec());

        // Canonical AoI authority：构建 frames 之前建立 ReplayAoiLifecycle，frame knowledge
        // 用 entityId + frame time 查询 observed segment / UNKNOWN_AOI gap（禁止再靠 5s/age 推断）。
        final List<AoiObservationSegment> aoiSegments =
                ReplayAoiLifecycle.build(recon.events(), clock.startRawClockSec());
        final Map<Integer, List<AoiObservationSegment>> aoiByEntity =
                ReplayAoiLifecycle.indexByEntity(aoiSegments);

        final List<BattleFrame> frames = new ArrayList<>(maxSecond + 1);
        final Map<Integer, Integer> prevHp = new HashMap<>();
        final Map<Integer, Double> prevHpObservedAt = new HashMap<>();
        final Map<Integer, VehicleKnowledgeState> prevKnowledge = new HashMap<>();
        final Map<Integer, FramePosition> prevPositions = new HashMap<>();
        final Map<Integer, Integer> prevRegions = new HashMap<>();
        final Map<Integer, Boolean> prevDestroyed = new HashMap<>();
        Map<Integer, FrameVehicle> prevVehicles = new HashMap<>();
        int prevFriendlyAlive = -1;
        int prevEnemyAlive = -1;
        int prevFriendlyPoints = Integer.MIN_VALUE;
        int prevEnemyPoints = Integer.MIN_VALUE;
        boolean firstContactSeen = false;
        int prevEnemyKnown = -1;
        int prevEnemyLastKnown = -1;
        int prevEnemyUnknown = -1;

        final TimelineMapEnricher enricher = new TimelineMapEnricher(
                battle == null ? "" : battle.mapName);

        // 交火活动强度只使用权威 HP loss（Type-8 raw 语义未证明）
        final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result combat =
                com.wotb.core.replay.feature.PlaybackCombatReconstruction.derive(
                        orderedEvents, mapping, clock.startRawClockSec(), duration, battle);

        for (int second = 0; second <= maxSecond; second++) {
            final double t = second;
            final List<FrameVehicle> vehicles = new ArrayList<>();
            for (final int entityId : index.knownEntityIdsAt(t)) {
                if (actualCombatantEntityIds.contains(entityId)) {
                    vehicles.add(frameVehicle(entityId, t, index, mapping, battle,
                            perspectiveTeam, enricher, aoiByEntity));
                }
            }
            vehicles.sort(Comparator.comparingInt(FrameVehicle::entityId));

            final List<ReplayEvent> windowEvents = eventsInWindow(
                    orderedEvents, clock.startRawClockSec(), t - 1.0, t);

            final WorldSummary world = worldSummary(vehicles, battle, perspectiveTeam, index, t);

            final Map<Integer, FrameVehicle> byId = new LinkedHashMap<>();
            for (final FrameVehicle v : vehicles) {
                byId.put(v.entityId(), v);
            }
            int trustedDamageInWindow = 0;
            for (final java.util.Map.Entry<Long,
                    List<com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss>> entry
                    : combat.lossesByVictim().entrySet()) {
                for (final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Loss loss
                        : entry.getValue()) {
                    if (loss.toSec() > t - 1.0 - 1e-6 && loss.toSec() <= t + 1e-6) {
                        trustedDamageInWindow += loss.hpLoss();
                    }
                }
            }
            final List<BattleDelta> deltas = BattleDeltaEngine.compute(
                    second, t, prevVehicles, byId, windowEvents, trustedDamageInWindow,
                    firstContactSeen, prevFriendlyAlive, prevEnemyAlive,
                    prevFriendlyPoints, prevEnemyPoints, prevEnemyKnown,
                    prevEnemyLastKnown, prevEnemyUnknown, world,
                    prevHp, prevHpObservedAt, prevKnowledge, prevPositions,
                    prevRegions, prevDestroyed);

            firstContactSeen = firstContactSeen
                    || windowEvents.stream().anyMatch(DamageEvent.class::isInstance);

            final Map<String, String> tacticalState = new LinkedHashMap<>();
            tacticalState.put("second", String.valueOf(second));
            if (battle != null && battle.mapName != null) {
                tacticalState.put("map", battle.mapName.trim().toLowerCase());
            }

            frames.add(new BattleFrame(second, t, world, List.copyOf(vehicles),
                    List.copyOf(windowEvents), List.copyOf(deltas),
                    Map.copyOf(tacticalState), List.of()));

            // update previous-state trackers for next frame
            prevVehicles = byId;
            prevFriendlyAlive = world.friendlyAlive();
            prevEnemyAlive = world.enemyAlive();
            prevFriendlyPoints = world.friendlyPoints() == null ? prevFriendlyPoints
                    : world.friendlyPoints();
            prevEnemyPoints = world.enemyPoints() == null ? prevEnemyPoints
                    : world.enemyPoints();
            prevEnemyKnown = world.enemyKnown();
            prevEnemyLastKnown = world.enemyLastKnown();
            prevEnemyUnknown = world.enemyUnknown();
            for (final FrameVehicle v : vehicles) {
                prevHp.put(v.entityId(), v.health() == null ? null : v.health().currentHp());
                prevHpObservedAt.put(v.entityId(),
                        v.health() == null ? null : v.health().observedAtSec());
                prevKnowledge.put(v.entityId(), v.knowledgeState());
                prevPositions.put(v.entityId(), v.position());
                prevRegions.put(v.entityId(),
                        v.mapState() == null ? null : v.mapState().gridRegion());
                prevDestroyed.put(v.entityId(),
                        v.lifeState() == LifeState.DESTROYED);
            }
        }

        final BattleTimeline timeline = new BattleTimeline(
                battle == null ? "" : battle.mapName.trim().toLowerCase(),
                duration,
                clock.startRawClockSec(),
                clock.resolution(),
                List.copyOf(frames),
                List.copyOf(orderedEvents),
                aoiSegments,
                BattleTimelineValidationResult.ok(),
                List.copyOf(limitations));
        return new BattleTimelineResult(timeline, timeline.validation());
    }

    // ===== validation =====

    static BattleTimelineValidationResult validate(
            final Battle battle,
            final ReplayReconstruction recon,
            final TimelinePerspective perspective) {
        final List<TimelineError> errors = new ArrayList<>();
        final List<String> messages = new ArrayList<>();

        if (recon == null || recon.metadata() == null) {
            errors.add(TimelineError.TIMELINE_META_INVALID);
            messages.add("replay metadata missing");
        } else if (!hasText(recon.metadata().mapName())) {
            errors.add(TimelineError.TIMELINE_MAP_UNRESOLVED);
            messages.add("map identity unresolvable (meta mapName blank)");
        }
        if (battle == null || battle.players == null || battle.players.isEmpty()) {
            errors.add(TimelineError.TIMELINE_RESULTS_INVALID);
            messages.add("battle results missing");
        } else {
            final boolean rosterUsable = battle.players.stream()
                    .anyMatch(p -> p != null && p.team > 0);
            if (!rosterUsable) {
                errors.add(TimelineError.TIMELINE_ROSTER_INCOMPLETE);
                messages.add("no player with usable team in roster");
            }
        }
        if (recon == null || recon.events() == null || recon.events().isEmpty()
                || recon.diagnostics() == null) {
            errors.add(TimelineError.TIMELINE_STREAM_CORRUPTED);
            messages.add("event stream empty or diagnostics missing");
        }
        if (perspective == null || perspective.perspectiveTeam() == null) {
            errors.add(TimelineError.TIMELINE_TEAM_UNRESOLVED);
            messages.add("perspective team unresolved");
        }
        if (perspective != null && perspective.type() == TimelineRequirements.PERSONAL
                && perspective.recorderAccountId() == null) {
            errors.add(TimelineError.TIMELINE_RECORDER_UNRESOLVED);
            messages.add("recorder account unresolved (personal review requires recorder identity)");
        }
        if (errors.isEmpty()) {
            return BattleTimelineValidationResult.ok();
        }
        return BattleTimelineValidationResult.invalid(errors, messages);
    }

    // ===== clock / duration =====

    record ClockResult(double startRawClockSec, BattleTimelineClock resolution) {
    }

    static ClockResult resolveClock(final Battle battle, final ReplayReconstruction recon) {
        final Float start = recon.battleStartRawClockSec();
        if (start != null && Float.isFinite(start)) {
            return new ClockResult(start, BattleTimelineClock.IDENTIFIED);
        }
        // 事件自带 battle-relative 时钟（未来 decoder 支持时）：仅当时钟域一致（全部携带
        // battleClockSec）才以 0 为基准；混合域（部分带、部分 raw-only）会混用两个时钟域，
        // 拒绝 0 基准、落到 ESTIMATED（raw 域统一），并在 build 阶段标记 MIXED_CLOCK_DOMAINS。
        boolean anyBattleClock = false;
        boolean anyRawOnly = false;
        for (final ReplayEvent e : recon.events()) {
            if (e.timestamp() == null) {
                continue;
            }
            if (e.timestamp().battleClockSec() != null) {
                anyBattleClock = true;
            } else {
                anyRawOnly = true;
            }
        }
        if (anyBattleClock && !anyRawOnly) {
            return new ClockResult(0d, BattleTimelineClock.IDENTIFIED);
        }
        if (battle != null && battle.durationS != null
                && Float.isFinite(battle.durationS.floatValue()) && battle.durationS > 0) {
            for (final ReplayEvent e : recon.events()) {
                if (e instanceof RoundFinishedEvent be && be.timestamp() != null) {
                    final float raw = be.timestamp().rawClockSec();
                    if (Float.isFinite(raw) && raw >= 0) {
                        final double estimatedStart = raw - battle.durationS.doubleValue();
                        if (estimatedStart >= 0) {
                            return new ClockResult(estimatedStart, BattleTimelineClock.ESTIMATED);
                        }
                        break;
                    }
                }
            }
            // The battle-start is resolved once in ReplayReconstructionService (incl. an ESTIMATED
            // lastClock - duration fallback), so recon.battleStartRawClockSec is the single agreed start;
            // the timeline reuses it directly (IDENTIFIED) and never derives a different one.
        }
        return new ClockResult(Double.NaN, BattleTimelineClock.UNRESOLVED);
    }

    static double resolveDurationSec(
            final Battle battle, final ReplayReconstruction recon, final double startRawClockSec) {
        if (battle != null && battle.durationS != null
                && Double.isFinite(battle.durationS) && battle.durationS > 0) {
            return battle.durationS;
        }
        double max = 0d;
        for (final ReplayEvent e : recon.events()) {
            final double t = TimelineClock.battleClockOf(e, startRawClockSec);
            if (Double.isFinite(t) && t > max) {
                max = t;
            }
        }
        return max;
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

    private static List<ReplayEvent> eventsInWindow(
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
            if (t > startExclusive) {
                out.add(e);
            }
        }
        return out;
    }

    // ===== frame vehicle construction =====

    private static FrameVehicle frameVehicle(
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

    // ===== world summary =====

    static WorldSummary worldSummary(
            final List<FrameVehicle> vehicles,
            final Battle battle,
            final int perspectiveTeam,
            final EntityIndex index,
            final double t) {
        int friendlyTotal = 0;
        int enemyTotal = 0;
        int friendlyDestroyed = 0;
        int enemyDestroyed = 0;
        int enemyKnown = 0;
        int enemyLastKnown = 0;
        int friendlyAlive = 0;
        int enemyAlive = 0;

        for (final FrameVehicle v : vehicles) {
            if (v.team() == null) {
                continue;
            }
            if (v.friendly()) {
                friendlyTotal++;
                if (v.lifeState() == LifeState.DESTROYED) {
                    friendlyDestroyed++;
                }
            } else {
                enemyTotal++;
                // knowledge partition 必须互斥：一辆车只属于一种知识状态；
                // DESTROYED_KNOWN ⟺ lifeState DESTROYED（frameVehicle 保证），只计一次 destroyed。
                switch (v.knowledgeState()) {
                    case POSITION_STREAM_ACTIVE -> enemyKnown++;
                    case LAST_KNOWN -> enemyLastKnown++;
                    case DESTROYED_KNOWN -> enemyDestroyed++;
                    case UNKNOWN -> {
                        // 从未观测到位置：计入 roster 未知（见下方 roster 计算）
                    }
                }
            }
        }

        // roster-level totals（account 级；含从未出现在事件流的车辆）
        final RosterCounts roster = rosterCounts(battle, perspectiveTeam);
        final int friendlyTotalRoster = roster.friendly();
        final int enemyTotalRoster = roster.enemy();
        if (friendlyTotalRoster > friendlyTotal) {
            friendlyTotal = friendlyTotalRoster;
        }
        if (enemyTotalRoster > enemyTotal) {
            enemyTotal = enemyTotalRoster;
        }

        friendlyAlive = friendlyTotal - friendlyDestroyed;
        enemyAlive = enemyTotal - enemyDestroyed;

        // 未知敌人数 = roster 敌人数 - 已知(含 last-known) - 已确知阵亡
        final int enemyKnownTotal = enemyKnown + enemyLastKnown;
        final int enemyUnknown = Math.max(0, enemyTotalRoster - enemyKnownTotal - enemyDestroyed);

        final PointsAt points = index.pointsAt(t, perspectiveTeam);

        return new WorldSummary(
                Math.max(0, friendlyAlive),
                Math.max(0, enemyAlive),
                Math.max(0, friendlyTotal),
                Math.max(0, enemyTotal),
                enemyKnown,
                enemyLastKnown,
                enemyUnknown,
                enemyDestroyed,
                points.friendly(),
                points.enemy());
    }

    record RosterCounts(int friendly, int enemy) {
    }

    /**
     * #301 actual combatant 账号集（battle.players，accountId > 0）。
     * spectator/observer/camera/场景静态实体不在 #301 中，即使出现在 #201 / updateArena2 / 事件流
     * 也不得进入 tactical vehicle universe（ActualCombatantSet == battle_results #301）。
     */
    static Set<Long> actualCombatantAccounts(final Battle battle) {
        if (battle == null || battle.players == null) {
            return Set.of();
        }
        final Set<Long> accounts = new HashSet<>();
        for (final PlayerResult p : battle.players) {
            if (p != null && p.accountId > 0) {
                accounts.add(p.accountId);
            }
        }
        return accounts;
    }

    static RosterCounts rosterCounts(final Battle battle, final int perspectiveTeam) {
        if (battle == null || battle.players == null || perspectiveTeam <= 0) {
            return new RosterCounts(0, 0);
        }
        int friendly = 0;
        int enemy = 0;
        for (final PlayerResult p : battle.players) {
            if (p != null && p.team > 0) {
                if (p.team == perspectiveTeam) {
                    friendly++;
                } else {
                    enemy++;
                }
            }
        }
        return new RosterCounts(friendly, enemy);
    }

    record PointsAt(Integer friendly, Integer enemy) {
    }

    // ===== helpers =====

    private static boolean hasText(final String s) {
        return s != null && !s.isBlank();
    }
}
