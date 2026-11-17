package com.wotb.core.replay.timeline;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.RoundFinishedEvent;
import com.wotb.core.replay.facts.AoiObservationSegment;
import com.wotb.core.replay.facts.ReplayAoiLifecycle;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.LifeState;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
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
 * Clock/duration、vehicle frame assembly、world/roster summary 分别委托给同 package owner。
 */
public final class BattleTimelineBuilder {

    /** 位置显著变化阈值（canonical 米）。 */
    static final double POSITION_CHANGE_THRESHOLD_M = 5.0;

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

        final TimelineClockResolver.ClockResult clock = TimelineClockResolver.resolveClock(battle, recon);
        if (clock.resolution() == BattleTimelineClock.UNRESOLVED) {
            return new BattleTimelineResult(null, BattleTimelineValidationResult.invalid(
                    TimelineError.TIMELINE_CLOCK_UNRESOLVED,
                    "battle-relative clock could not be resolved (no battle start (wrapper3 BATTLE), no RoundFinishedEvent (method4), no duration)"));
        }

        final double duration = TimelineClockResolver.resolveDurationSec(battle, recon, clock.startRawClockSec());
        if (!(duration > 0) || !Double.isFinite(duration)) {
            return new BattleTimelineResult(null, BattleTimelineValidationResult.invalid(
                    TimelineError.TIMELINE_META_INVALID, "battle duration unusable"));
        }
        final int maxSecond = (int) Math.ceil(duration);
        if (maxSecond > TimelineClockResolver.MAX_FRAMES) {
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
        final Set<Long> actualCombatantAccounts = TimelineRosterSummary.actualCombatantAccounts(battle);
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

        final List<ReplayEvent> orderedEvents = TimelineFrameAssembler.orderedEvents(
                recon.events(), clock.startRawClockSec());

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
                    vehicles.add(TimelineFrameAssembler.frameVehicle(entityId, t, index, mapping, battle,
                            perspectiveTeam, enricher, aoiByEntity));
                }
            }
            vehicles.sort(Comparator.comparingInt(FrameVehicle::entityId));

            final List<ReplayEvent> windowEvents = TimelineFrameAssembler.eventsInWindow(
                    orderedEvents, clock.startRawClockSec(), t - 1.0, t);

            final WorldSummary world = TimelineRosterSummary.worldSummary(
                    vehicles, battle, perspectiveTeam, index, t);

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

    private static boolean hasText(final String s) {
        return s != null && !s.isBlank();
    }
}
