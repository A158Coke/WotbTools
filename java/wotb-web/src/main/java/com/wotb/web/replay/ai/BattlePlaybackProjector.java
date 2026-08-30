package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.ConsumableLifecycleEvent;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.SupremacyPointsChangedEvent;
import com.wotb.core.replay.event.VehicleBattleLoadout;
import com.wotb.core.replay.event.VehicleDestroyedEvent;
import com.wotb.core.replay.event.VehicleHitEvent;
import com.wotb.core.replay.facts.ConsumableLifecycle;
import com.wotb.core.replay.facts.AoiObservationSegment;
import com.wotb.core.replay.facts.VehicleLoadoutFacts;
import com.wotb.core.replay.facts.VehicleModuleCrewLifecycle;
import com.wotb.core.replay.facts.VehicleModuleCrewLifecycle.ModuleCrewObservation;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.timeline.BattleFrame;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.timeline.FrameHealth;
import com.wotb.core.replay.timeline.FramePosition;
import com.wotb.core.replay.timeline.FrameVehicle;
import com.wotb.core.replay.timeline.FrameOrientation;
import com.wotb.core.replay.timeline.PositionKnowledge;
import com.wotb.core.replay.reconstruction.LifeState;
import com.wotb.web.replay.dto.BattlePlaybackDataset;
import com.wotb.web.replay.dto.BattlePlaybackDataset.ConsumableTransition;
import com.wotb.web.replay.dto.BattlePlaybackDataset.ConfidenceDto;
import com.wotb.web.replay.dto.BattlePlaybackDataset.BattleEvent;
import com.wotb.web.replay.dto.BattlePlaybackDataset.ShotTrack;
import com.wotb.web.replay.dto.BattlePlaybackDataset.HealthTransition;
import com.wotb.web.replay.dto.BattlePlaybackDataset.LifeTransition;
import com.wotb.web.replay.dto.BattlePlaybackDataset.ModuleCrewTransition;
import com.wotb.web.replay.dto.BattlePlaybackDataset.OrientationSample;
import com.wotb.web.replay.dto.BattlePlaybackDataset.OrientationSegment;
import com.wotb.web.replay.dto.BattlePlaybackDataset.PointsSample;
import com.wotb.web.replay.dto.BattlePlaybackDataset.PositionSample;
import com.wotb.web.replay.dto.BattlePlaybackDataset.PositionSegment;
import com.wotb.web.replay.dto.BattlePlaybackDataset.VehicleBattleLoadoutDto;
import com.wotb.web.replay.dto.BattlePlaybackDataset.VehiclePlaybackTrack;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;

/**
 * Battle Playback V2 <b>pure projection</b>（plan §22）：把 canonical {@link BattleTimeline}
 * + canonical facts（loadout / consumable / module-crew）投影为 {@link BattlePlaybackDataset}。
 *
 * <p><b>禁止</b>：扫描 raw events、构造自己的 HP/death/AoI/direction truth。全部事实已由
 * canonical Timeline / facts 层权威化，本类只做稀疏 transition track 投影 + transport 语义。</p>
 *
 * <p>前端<b>不得</b>再做 HP/AoI/death/loadout inference —— 只接受本契约的 knowledge/provenance
 * 与已标注的 observation boundary。</p>
 */
public final class BattlePlaybackProjector {

    private BattlePlaybackProjector() {
    }

    public static BattlePlaybackDataset project(
            final Battle battle,
            final BattleTimeline timeline,
            final TeamEntityMapping mapping,
            final Long recorderAccountId) {
        if (battle == null || timeline == null || mapping == null) {
            return null;
        }
        final double duration = timeline.durationSec();
        if (!(duration > 0)) {
            return null;
        }

        // canonical facts（provenance + AoI scoped）
        final Map<Long, List<VehicleLoadoutFacts.LoadoutObservation>> loadoutByAccount =
                VehicleLoadoutFacts.build(timeline.events(), mapping, timeline.battleStartRawClockSec());
        final Map<Long, List<ConsumableLifecycle.ConsumableObservation>> consumableByAccount =
                ConsumableLifecycle.build(timeline.events(), mapping, timeline.battleStartRawClockSec());
        final Map<Long, List<ModuleCrewObservation>> moduleByAccount =
                VehicleModuleCrewLifecycle.build(timeline.events(), mapping, recorderAccountId,
                        timeline.battleStartRawClockSec());

        final Long effectiveRecorder = recorderAccountId != null
                ? recorderAccountId : recorderAccountId(battle);
        final Integer friendlyTeam = friendlyTeam(battle, effectiveRecorder);

        final List<VehiclePlaybackTrack> tracks = new ArrayList<>();
        for (final PlayerResult player : battle.players) {
            if (player.team <= 0 || player.accountId <= 0) {
                continue;
            }
            final List<Integer> entityIds = mapping.entityIdsByAccount()
                    .getOrDefault(player.accountId, List.of());
            if (entityIds.isEmpty()) {
                continue;
            }
            final VehiclePlaybackTrack track = projectVehicle(
                    player, entityIds, timeline, battle, effectiveRecorder, friendlyTeam,
                    loadoutByAccount,
                    consumableByAccount.get(player.accountId),
                    moduleByAccount.get(player.accountId));
            tracks.add(track);
        }
        if (tracks.isEmpty()) {
            return null;
        }
        tracks.sort(Comparator.comparingLong(VehiclePlaybackTrack::accountId));

        return new BattlePlaybackDataset(
                duration,
                timeline.mapCode() == null ? null : timeline.mapCode(),
                friendlyTeam,
                effectiveRecorder,
                tracks,
                events(timeline, mapping, tracks, effectiveRecorder, duration),
                shots(timeline, mapping),
                pointsSamples(timeline),
                timeline.limitations(),
                null,
                battle.arenaBonusType);
    }

    private static VehiclePlaybackTrack projectVehicle(
            final PlayerResult player,
            final List<Integer> entityIds,
            final BattleTimeline timeline,
            final Battle battle,
            final Long recorderAccountId,
            final Integer friendlyTeam,
            final Map<Long, List<VehicleLoadoutFacts.LoadoutObservation>> loadoutByAccount,
            final List<ConsumableLifecycle.ConsumableObservation> consumableObservations,
            final List<ModuleCrewObservation> moduleObservations) {
        final boolean friendly = player.team == (friendlyTeam != null ? friendlyTeam : 0);
        // 稀疏 transition tracks：跨 vehicles 的所有 frame，去重 sequence（timeSec + entityId 天然序）。
        final List<PositionSegment> positionSegments = positionSegments(timeline, entityIds);
        final List<OrientationSegment> orientationSegments = orientationSegments(timeline, entityIds);
        final List<HealthTransition> health = healthTransitions(timeline, entityIds);
        final List<LifeTransition> life = lifeTransitions(timeline, entityIds);
        final List<ConsumableTransition> consumables =
                consumableTransitions(consumableObservations, timeline, entityIds);
        final List<ModuleCrewTransition> modules = moduleCrewTransitions(moduleObservations);

        final VehicleBattleLoadoutDto loadout = toLoadoutDto(
                VehicleLoadoutFacts.loadoutAtOrBefore(loadoutByAccount,
                        player.accountId, timeline.durationSec()));

        return new VehiclePlaybackTrack(
                player.accountId,
                player.nickname == null ? "" : player.nickname,
                player.tankId,
                com.wotb.core.ref.ReplayDisplayNames.tankName(player.tankId, player.tankName),
                com.wotb.core.ref.ReplayDisplayNames.tankClass(player.tankId),
                tierOf(player.tankId),
                player.team,
                friendly,
                loadout,
                positionSegments,
                orientationSegments,
                health,
                life,
                consumables,
                modules);
    }

    private static Integer tierOf(final long tankId) {
        if (tankId <= 0) {
            return null;
        }
        final String tier = com.wotb.core.ref.ReplayDisplayNames.tankTier(tankId);
        if (tier == null || tier.isBlank()) {
            return null;
        }
        try {
            return Integer.valueOf(tier.trim());
        } catch (final NumberFormatException e) {
            return null;
        }
    }

    private static List<PositionSegment> positionSegments(final BattleTimeline timeline,
                                                          final List<Integer> entityIds) {
        // 每个 entity 的 frame 位置采样按 AoI segment 分簇；段之间 = UNKNOWN_AOI。
        final List<PositionSegment> out = new ArrayList<>();
        for (final int entityId : entityIds) {
            // 位置样本（每帧一次，取有 position 的帧）
            final List<PositionSample> samples = new ArrayList<>();
            for (final BattleFrame frame : timeline.frames()) {
                final FrameVehicle v = vehicleIn(frame, entityId);
                if (v == null || v.position() == null || v.position().position() == null) {
                    continue;
                }
                final FramePosition p = v.position();
                samples.add(new PositionSample(frame.stateAtSec(), p.position().x(), p.position().z(),
                        p.knowledge() == PositionKnowledge.CURRENT ? "OBSERVED" : "LAST_KNOWN"));
            }
            if (samples.isEmpty()) {
                continue;
            }
            // 简单确定性：整个时间轴按 knowledge 分段（OBSERVED / LAST_KNOWN 交替）。
            String curKnowledge = samples.get(0).knowledge();
            int segStart = 0;
            for (int i = 1; i <= samples.size(); i++) {
                if (i == samples.size() || !samples.get(i).knowledge().equals(curKnowledge)) {
                    final List<PositionSample> seg = samples.subList(segStart, i);
                    out.add(new PositionSegment(
                            seg.get(0).timeSec(), seg.get(seg.size() - 1).timeSec(),
                            curKnowledge, "OBSERVED".equals(curKnowledge), List.copyOf(seg)));
                    if (i < samples.size()) {
                        curKnowledge = samples.get(i).knowledge();
                        segStart = i;
                    }
                }
            }
        }
        out.sort(Comparator.comparingDouble(PositionSegment::startSec));
        return out;
    }

    private static List<OrientationSegment> orientationSegments(final BattleTimeline timeline,
                                                                final List<Integer> entityIds) {
        final List<OrientationSegment> out = new ArrayList<>();
        for (final int entityId : entityIds) {
            // 每帧取一次方向样本（有 hull yaw），并携带该帧的 canonical orientation knowledge
            // （CURRENT / LAST_KNOWN / UNKNOWN）。knowledge 会随 AoI hidden gap 变化，
            // 必须按 knowledge 分段，禁止把整条时间轴焊成一个硬编码 "CURRENT" 段。
            final List<OrientationSample> samples = new ArrayList<>();
            for (final BattleFrame frame : timeline.frames()) {
                final FrameVehicle v = vehicleIn(frame, entityId);
                if (v == null || v.orientation() == null || v.orientation().hullYawDeg() == null) {
                    continue;
                }
                samples.add(new OrientationSample(frame.stateAtSec(),
                        v.orientation().hullYawDeg().doubleValue(),
                        v.orientation().turretRelativeYawDeg() == null ? null
                                : v.orientation().turretRelativeYawDeg().doubleValue(),
                        orientationKnowledgeName(v.orientation().knowledge())));
            }
            if (samples.isEmpty()) {
                continue;
            }
            // 与 positionSegments 同构：整条时间轴按 knowledge 分段（CURRENT / LAST_KNOWN 交替）。
            String curKnowledge = samples.get(0).knowledge();
            int segStart = 0;
            for (int i = 1; i <= samples.size(); i++) {
                if (i == samples.size() || !samples.get(i).knowledge().equals(curKnowledge)) {
                    final List<OrientationSample> seg = samples.subList(segStart, i);
                    out.add(new OrientationSegment(
                            seg.get(0).timeSec(), seg.get(seg.size() - 1).timeSec(),
                            curKnowledge, List.copyOf(seg)));
                    if (i < samples.size()) {
                        curKnowledge = samples.get(i).knowledge();
                        segStart = i;
                    }
                }
            }
        }
        out.sort(Comparator.comparingDouble(OrientationSegment::startSec));
        return out;
    }

    private static String orientationKnowledgeName(final FrameOrientation.OrientationKnowledge k) {
        return k == null ? "UNKNOWN" : k.name();
    }

    private static List<HealthTransition> healthTransitions(final BattleTimeline timeline,
                                                            final List<Integer> entityIds) {
        final List<HealthTransition> out = new ArrayList<>();
        for (final int entityId : entityIds) {
            for (final BattleFrame frame : timeline.frames()) {
                final FrameVehicle v = vehicleIn(frame, entityId);
                if (v == null || v.health() == null || v.health().currentHp() == null) {
                    continue;
                }
                final FrameHealth h = v.health();
                out.add(new HealthTransition(frame.stateAtSec(), h.currentHp(),
                        h.knowledge() == null ? "UNKNOWN" : h.knowledge().name(),
                        h.source() == null ? "UNKNOWN" : h.source().name(),
                        h.displayCapacityHp(), toConfidence(h.confidence())));
            }
        }
        out.sort(Comparator.comparingDouble(HealthTransition::timeSec));
        return out;
    }

    private static List<LifeTransition> lifeTransitions(final BattleTimeline timeline,
                                                        final List<Integer> entityIds) {
        final List<LifeTransition> out = new ArrayList<>();
        for (final int entityId : entityIds) {
            for (final BattleFrame frame : timeline.frames()) {
                final FrameVehicle v = vehicleIn(frame, entityId);
                if (v == null) {
                    continue;
                }
                final String state = v.lifeState() == null ? "UNKNOWN" : v.lifeState().name();
                if (!out.isEmpty() && out.get(out.size() - 1).lifeState().equals(state)
                        && !"DESTROYED".equals(state)) {
                    continue;
                }
                out.add(new LifeTransition(frame.stateAtSec(), state,
                        v.destroyedKnownAtSec() != null ? v.destroyedKnownAtSec() : null));
            }
        }
        out.sort(Comparator.comparingDouble(LifeTransition::timeSec));
        return out;
    }

    private static List<ConsumableTransition> consumableTransitions(
            final List<ConsumableLifecycle.ConsumableObservation> observations,
            final BattleTimeline timeline,
            final List<Integer> entityIds) {
        final List<ConsumableTransition> out = new ArrayList<>();
        // 真实观测 transition（KNOWN runtime 事实；state 未证明 → UNKNOWN）。
        if (observations != null) {
            for (final ConsumableLifecycle.ConsumableObservation o : observations) {
                out.add(new ConsumableTransition(o.timeSec(), null, o.logicalItemId(), o.wireCode(),
                        o.state() == null || o.state() == ConsumableLifecycleEvent.ConsumableLifecycleState.UNKNOWN
                                ? "UNKNOWN" : o.state().name(),
                        toConfidence(o.confidence())));
            }
        }
        // AoI hidden 边界：canonical contract —— known runtime 在 AoI 关闭（Type4 absent）后必须
        // 显式插入 UNKNOWN transition，直到下一次重入（observedFrom）由后续观测接管。
        // 前端 lastAtOrBefore 取最近一次 ≤t，因此 hidden 区间查询会命中此 UNKNOWN（而非残留 ACTIVATED）。
        if (timeline != null && timeline.aoiSegments() != null && entityIds != null) {
            final java.util.Set<Integer> idSet = java.util.Set.copyOf(entityIds);
            for (final AoiObservationSegment seg : timeline.aoiSegments()) {
                if (seg != null && seg.closed() && idSet.contains(seg.entityId())) {
                    final double absent = seg.absentFromSec();
                    final boolean hadKnownBefore = hasObservationBefore(observations, absent);
                    // 仅在曾有过已知 runtime 观测的车辆上插入 UNKNOWN（未曾观测则保持 UNKNOWN 语义不变，
                    // 不制造多余 transition）。AoI close @absent 只能使用 <=absent 的事实（anti-future-leak）；
                    // 之后（如后续 TEARDOWN）由 lastAtOrBefore 自然覆盖，绝不读取未来 observation 决定当前状态。
                    if (hadKnownBefore) {
                        out.add(new ConsumableTransition(absent, null, null, null,
                                "UNKNOWN", com.wotb.web.replay.dto.BattlePlaybackDataset.ConfidenceDto.UNKNOWN));
                    }
                }
            }
        }
        out.sort(Comparator.comparingDouble(ConsumableTransition::timeSec));
        return out;
    }

    /** 是否在 t 之前（含 close 时刻之前）存在真实 KNOWN 观测（logicalItemId 非 null 或 state 非 UNKNOWN）。 */
    private static boolean hasObservationBefore(
            final List<ConsumableLifecycle.ConsumableObservation> observations, final double t) {
        if (observations == null) {
            return false;
        }
        for (final ConsumableLifecycle.ConsumableObservation o : observations) {
            if (o.timeSec() < t - 1e-6
                    && (o.logicalItemId() != null
                        || o.state() != ConsumableLifecycleEvent.ConsumableLifecycleState.UNKNOWN)) {
                return true;
            }
        }
        return false;
    }

    private static List<ModuleCrewTransition> moduleCrewTransitions(
            final List<ModuleCrewObservation> observations) {
        if (observations == null) {
            return List.of();
        }
        final List<ModuleCrewTransition> out = new ArrayList<>();
        for (final ModuleCrewObservation o : observations) {
            out.add(new ModuleCrewTransition(o.timeSec(),
                    o.component() == null ? "UNKNOWN" : o.component().name(),
                    o.state() == null ? "UNKNOWN" : o.state().name(),
                    o.recorderVisible(), toConfidence(o.confidence())));
        }
        out.sort(Comparator.comparingDouble(ModuleCrewTransition::timeSec));
        return out;
    }

    /**
     * battle-level 时间轴事件（canonical）：DAMAGE / DESTROYED / KILL / POSITION_REPORTED / POSITION_STALE。
     * 伤害/击毁从 {@code PlaybackCombatReconstruction}（唯一伤害权威）与 canonical {@code timeline.events()}
     * 推导，不重扫 raw、不使用 Type-8 raw 协议值。POSITION_* 来自 canonical AoI observed segment
     * （{@code positionSegments} 每车的 OBSERVED 段起止），录像者自身不广播位置覆盖事件。
     */
    private static List<BattleEvent> events(final BattleTimeline timeline,
                                            final TeamEntityMapping mapping,
                                            final List<BattlePlaybackDataset.VehiclePlaybackTrack> tracks,
                                            final Long recorderAccount,
                                            final double duration) {
        if (timeline.events() == null || mapping == null) {
            return List.of();
        }
        final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Result combat =
                com.wotb.core.replay.feature.PlaybackCombatReconstruction.derive(
                        timeline.events(), mapping,
                        Double.isFinite(timeline.battleStartRawClockSec())
                                ? timeline.battleStartRawClockSec() : 0.0,
                        duration);
        final java.util.Set<Long> destroyedVictims = new java.util.HashSet<>();
        final List<BattleEvent> out = new ArrayList<>();
        for (final ReplayEvent event : timeline.events()) {
            if (event instanceof DamageEvent damage) {
                final long victim = accountOf(mapping, damage.victimEid());
                if (victim <= 0) {
                    continue;
                }
                final long attacker = accountOf(mapping, damage.attackerEid());
                final double t = battleClockOf(event, timeline);
                out.add(new BattleEvent("DAMAGE", t, attacker > 0 ? attacker : null, victim,
                        com.wotb.core.replay.feature.PlaybackCombatReconstruction
                                .observedHpLossAt(combat, victim, t)));
            } else if (event instanceof VehicleHitEvent hit) {
                final long victim = accountOf(mapping, hit.victimEntityId());
                if (victim <= 0) {
                    continue;
                }
                final long attacker = accountOf(mapping, hit.attackerEntityId());
                final double t = battleClockOf(event, timeline);
                out.add(new BattleEvent("DAMAGE", t, attacker > 0 ? attacker : null, victim,
                        com.wotb.core.replay.feature.PlaybackCombatReconstruction
                                .observedHpLossAt(combat, victim, t)));
            } else if (event instanceof VehicleDestroyedEvent destroyed) {
                final long victim = accountOf(mapping, destroyed.entityId());
                if (victim <= 0) {
                    continue;
                }
                destroyedVictims.add(victim);
                out.add(new BattleEvent("DESTROYED", battleClockOf(event, timeline), victim, null, null));
                final Integer killerEid = destroyed.killerEid();
                final long killer = killerEid != null ? accountOf(mapping, killerEid) : 0L;
                if (killer > 0 && killer != victim) {
                    out.add(new BattleEvent("KILL", battleClockOf(event, timeline), killer, victim, null));
                }
            }
        }
        // 权威击毁推导（type-7 alive=false/HP=0）：不被显式 VehicleDestroyedEvent 覆盖的受害者
        for (final com.wotb.core.replay.feature.PlaybackCombatReconstruction.Destroyed d
                : combat.destroyed()) {
            if (destroyedVictims.contains(d.victimAccountId())) {
                continue;
            }
            out.add(new BattleEvent("DESTROYED", d.timeSec(), d.victimAccountId(), null, null));
            if (d.killerAccountId() != null && d.killerAccountId() != d.victimAccountId()) {
                out.add(new BattleEvent("KILL", d.timeSec(), d.killerAccountId(), d.victimAccountId(), null));
            }
        }
        // POSITION_*：canonical AoI observed segment 起止；录像者自身不广播
        for (final BattlePlaybackDataset.VehiclePlaybackTrack track : tracks) {
            if (recorderAccount != null && track.accountId() == recorderAccount) {
                continue;
            }
            emitPositionEvents(out, track, duration);
        }
        out.sort(Comparator.comparingDouble(BattleEvent::timeSec));
        return List.copyOf(out);
    }

    private static void emitPositionEvents(final List<BattleEvent> out,
                                           final BattlePlaybackDataset.VehiclePlaybackTrack track,
                                           final double duration) {
        for (final BattlePlaybackDataset.PositionSegment seg : track.positionSegments()) {
            if (seg.knowledge() == null || !"OBSERVED".equals(seg.knowledge())) {
                continue;
            }
            final double start = Math.max(0, seg.startSec());
            final double end = Math.min(duration, seg.endSec());
            if (end < start || end < 0) {
                continue;
            }
            out.add(new BattleEvent("POSITION_REPORTED", start, track.accountId(), null, null));
            out.add(new BattleEvent("POSITION_STALE", end, track.accountId(), null, null));
        }
    }

    private static List<ShotTrack> shots(final BattleTimeline timeline, final TeamEntityMapping mapping) {
        // 射击轨道保留 ShotLifecycle 当前确定性 pairing（exact rawClock + sequence order）。
        // V2 只投影 launcher + 已知端点；不在此推导 intermediate shell path（那是 presentation）。
        final List<ShotTrack> out = new ArrayList<>();
        if (timeline.events() == null) {
            return out;
        }
        // 使用已证明的 shot 生命周期事实（ShotLifecycle）避免重扫 raw 语义。
        for (final com.wotb.core.replay.facts.ShotFact s
                : com.wotb.core.replay.facts.ShotLifecycle.build(
                        timeline.events(), mapping, null, timeline.battleStartRawClockSec())) {
            out.add(new ShotTrack(s.shooterAccountId(), s.launchTimeSec(), s.terminalTimeSec(), null));
        }
        out.sort(Comparator.comparingDouble(ShotTrack::launchTimeSec));
        return out;
    }

    private static List<PointsSample> pointsSamples(final BattleTimeline timeline) {
        if (timeline.events() == null) {
            return List.of();
        }
        final List<PointsSample> samples = new ArrayList<>();
        for (final ReplayEvent e : timeline.events()) {
            if (e instanceof SupremacyPointsChangedEvent sp
                    && sp.confidence() == DecodeConfidence.EXACT
                    && (sp.team() == 1 || sp.team() == 2)) {
                samples.add(new PointsSample(battleClockOf(e, timeline), sp.team(), sp.points()));
            }
        }
        samples.sort(Comparator.comparingDouble(PointsSample::timeSec));
        return samples;
    }

    private static VehicleBattleLoadoutDto toLoadoutDto(final VehicleBattleLoadout l) {
        if (l == null) {
            return null;
        }
        final List<String> consumables = new ArrayList<>();
        final List<Integer> codes = new ArrayList<>();
        for (final VehicleBattleLoadout.LoadoutItemSlot c : l.consumables()) {
            consumables.add(c.logicalItemId());
            codes.add(c.wireCode());
        }
        final List<String> provisions = new ArrayList<>();
        final List<Integer> pCodes = new ArrayList<>();
        for (final VehicleBattleLoadout.LoadoutItemSlot p : l.provisions()) {
            provisions.add(p.logicalItemId());
            pCodes.add(p.wireCode());
        }
        final List<Integer> equipment = new ArrayList<>();
        for (final VehicleBattleLoadout.EquipmentSelection e : l.equipment()) {
            equipment.add(e.equipmentId());
        }
        return new VehicleBattleLoadoutDto(l.replayVersion(), consumables, codes, provisions, pCodes,
                equipment, l.confidence());
    }

    private static ConfidenceDto toConfidence(final com.wotb.core.replay.timeline.Confidence c) {
        if (c == null) {
            return ConfidenceDto.UNKNOWN;
        }
        return switch (c) {
            case HIGH -> ConfidenceDto.HIGH;
            case MEDIUM -> ConfidenceDto.MEDIUM;
            case LOW -> ConfidenceDto.LOW;
            case UNKNOWN -> ConfidenceDto.UNKNOWN;
        };
    }

    private static ConfidenceDto toConfidence(final DecodeConfidence c) {
        if (c == null) {
            return ConfidenceDto.UNKNOWN;
        }
        return switch (c) {
            case EXACT -> ConfidenceDto.HIGH;
            case INFERRED, PARTIAL -> ConfidenceDto.MEDIUM;
            case UNKNOWN -> ConfidenceDto.UNKNOWN;
        };
    }

    private static FrameVehicle vehicleIn(final BattleFrame frame, final int entityId) {
        for (final FrameVehicle v : frame.vehicles()) {
            if (v != null && v.entityId() == entityId) {
                return v;
            }
        }
        return null;
    }

    /** entityId → accountId；无法解析或未映射为参战账号 → -1。 */
    private static long accountOf(final TeamEntityMapping mapping, final int entityId) {
        final TeamEntityIdentity identity = mapping.identity(entityId);
        return identity != null && identity.accountId() > 0 ? identity.accountId() : -1L;
    }

    private static double battleClockOf(final ReplayEvent e, final BattleTimeline timeline) {
        if (e.timestamp() == null) {
            return Double.NaN;
        }
        final double raw = e.timestamp().rawClockSec();
        final Double start = timeline.battleStartRawClockSec();
        return start != null && Double.isFinite(start) ? raw - start : raw;
    }

    private static Long recorderAccountId(final Battle battle) {
        if (battle == null || battle.recorderResult() == null) {
            return null;
        }
        return battle.recorderResult().accountId > 0 ? battle.recorderResult().accountId : null;
    }

    private static Integer friendlyTeam(final Battle battle, final Long recorderAccount) {
        if (battle == null || recorderAccount == null) {
            return null;
        }
        for (final PlayerResult p : battle.players) {
            if (p.accountId == recorderAccount && p.team > 0) {
                return p.team;
            }
        }
        return null;
    }
}
