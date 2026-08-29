package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.ConsumableLifecycleEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.SupremacyPointsChangedEvent;
import com.wotb.core.replay.event.VehicleBattleLoadout;
import com.wotb.core.replay.facts.ConsumableLifecycle;
import com.wotb.core.replay.facts.VehicleLoadoutFacts;
import com.wotb.core.replay.facts.VehicleModuleCrewLifecycle;
import com.wotb.core.replay.facts.VehicleModuleCrewLifecycle.ModuleCrewObservation;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.timeline.BattleFrame;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.timeline.FrameHealth;
import com.wotb.core.replay.timeline.FramePosition;
import com.wotb.core.replay.timeline.FrameVehicle;
import com.wotb.core.replay.timeline.PositionKnowledge;
import com.wotb.core.replay.reconstruction.LifeState;
import com.wotb.web.replay.dto.BattlePlaybackDataset;
import com.wotb.web.replay.dto.BattlePlaybackDataset.ConsumableTransition;
import com.wotb.web.replay.dto.BattlePlaybackDataset.ConfidenceDto;
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
import com.wotb.web.replay.dto.BattlePlaybackDataset.ShotTrack;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
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
                    loadoutByAccount.get(player.accountId),
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
                shots(timeline, mapping),
                pointsSamples(timeline),
                timeline.limitations());
    }

    private static VehiclePlaybackTrack projectVehicle(
            final PlayerResult player,
            final List<Integer> entityIds,
            final BattleTimeline timeline,
            final Battle battle,
            final Long recorderAccountId,
            final Integer friendlyTeam,
            final List<VehicleLoadoutFacts.LoadoutObservation> loadoutObservations,
            final List<ConsumableLifecycle.ConsumableObservation> consumableObservations,
            final List<ModuleCrewObservation> moduleObservations) {
        final boolean friendly = player.team == (friendlyTeam != null ? friendlyTeam : 0);
        // 稀疏 transition tracks：跨 vehicles 的所有 frame，去重 sequence（timeSec + entityId 天然序）。
        final List<PositionSegment> positionSegments = positionSegments(timeline, entityIds);
        final List<OrientationSegment> orientationSegments = orientationSegments(timeline, entityIds);
        final List<HealthTransition> health = healthTransitions(timeline, entityIds);
        final List<LifeTransition> life = lifeTransitions(timeline, entityIds);
        final List<ConsumableTransition> consumables = consumableTransitions(consumableObservations);
        final List<ModuleCrewTransition> modules = moduleCrewTransitions(moduleObservations);

        final VehicleBattleLoadoutDto loadout = toLoadoutDto(
                VehicleLoadoutFacts.loadoutAtOrBefore(loadoutByAccountOf(loadoutObservations),
                        player.accountId, timeline.durationSec()));

        return new VehiclePlaybackTrack(
                player.accountId,
                player.nickname == null ? "" : player.nickname,
                player.tankId,
                com.wotb.core.ref.ReplayDisplayNames.tankName(player.tankId, player.tankName),
                player.tankType == null ? "" : player.tankType,
                null,
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

    private static Map<Long, List<VehicleLoadoutFacts.LoadoutObservation>> loadoutByAccountOf(
            final List<VehicleLoadoutFacts.LoadoutObservation> observations) {
        final Map<Long, List<VehicleLoadoutFacts.LoadoutObservation>> map = new LinkedHashMap<>();
        for (final VehicleLoadoutFacts.LoadoutObservation o : observations) {
            map.computeIfAbsent(o.accountId(), k -> new ArrayList<>()).add(o);
        }
        map.values().forEach(l -> l.sort(Comparator.comparingDouble(VehicleLoadoutFacts.LoadoutObservation::timeSec)));
        return map;
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
            final List<OrientationSample> samples = new ArrayList<>();
            for (final BattleFrame frame : timeline.frames()) {
                final FrameVehicle v = vehicleIn(frame, entityId);
                if (v == null || v.orientation() == null || v.orientation().hullYawDeg() == null) {
                    continue;
                }
                samples.add(new OrientationSample(frame.stateAtSec(),
                        v.orientation().hullYawDeg().doubleValue(),
                        v.orientation().turretRelativeYawDeg() == null ? null
                                : v.orientation().turretRelativeYawDeg().doubleValue()));
            }
            if (!samples.isEmpty()) {
                out.add(new OrientationSegment(
                        samples.get(0).timeSec(), samples.get(samples.size() - 1).timeSec(),
                        "CURRENT", List.copyOf(samples)));
            }
        }
        out.sort(Comparator.comparingDouble(OrientationSegment::startSec));
        return out;
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
            final List<ConsumableLifecycle.ConsumableObservation> observations) {
        if (observations == null) {
            return List.of();
        }
        final List<ConsumableTransition> out = new ArrayList<>();
        for (final ConsumableLifecycle.ConsumableObservation o : observations) {
            out.add(new ConsumableTransition(o.timeSec(), null, o.logicalItemId(), o.wireCode(),
                    o.state() == null ? "UNKNOWN" : o.state().name(), toConfidence(o.confidence())));
        }
        out.sort(Comparator.comparingDouble(ConsumableTransition::timeSec));
        return out;
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
