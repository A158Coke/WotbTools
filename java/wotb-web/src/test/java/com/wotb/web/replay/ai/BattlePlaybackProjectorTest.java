package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.processing.TeamEntityIdentity;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayReconstructionService;
import com.wotb.core.replay.reconstruction.LifeState;
import com.wotb.core.replay.reconstruction.Vector3;
import com.wotb.core.replay.timeline.BattleFrame;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.BattleTimelineClock;
import com.wotb.core.replay.timeline.BattleTimelineResult;
import com.wotb.core.replay.timeline.BattleTimelineValidationResult;
import com.wotb.core.replay.timeline.Confidence;
import com.wotb.core.replay.timeline.FrameHealth;
import com.wotb.core.replay.timeline.FrameMapState;
import com.wotb.core.replay.timeline.FrameOrientation;
import com.wotb.core.replay.timeline.FramePosition;
import com.wotb.core.replay.timeline.FrameVehicle;
import com.wotb.core.replay.timeline.HpSource;
import com.wotb.core.replay.timeline.PositionKnowledge;
import com.wotb.core.replay.timeline.PositionSource;
import com.wotb.core.replay.timeline.VehicleKnowledgeState;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.VehicleBattleLoadout;
import com.wotb.core.replay.facts.AoiObservationSegment;
import com.wotb.core.replay.timeline.TimelineError;
import com.wotb.core.replay.timeline.TimelinePerspective;
import com.wotb.web.replay.dto.BattlePlaybackDataset;
import com.wotb.web.replay.dto.BattlePlaybackDataset.ConfidenceDto;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * BattlePlaybackProjector V2：从 canonical timeline + facts 稀疏投影到
 * {@link BattlePlaybackDataset}。真实夹具验证 —— timeline 可用时必须产出可用 dataset。
 */
class BattlePlaybackProjectorTest {

    @Test
    void loadoutConfidenceMapsDomainEnumToPlaybackWireEnum() {
        final Map<DecodeConfidence, ConfidenceDto> expected = Map.of(
                DecodeConfidence.EXACT, ConfidenceDto.HIGH,
                DecodeConfidence.INFERRED, ConfidenceDto.MEDIUM,
                DecodeConfidence.PARTIAL, ConfidenceDto.LOW,
                DecodeConfidence.UNKNOWN, ConfidenceDto.UNKNOWN);
        for (final Map.Entry<DecodeConfidence, ConfidenceDto> entry : expected.entrySet()) {
            final VehicleBattleLoadout loadout = new VehicleBattleLoadout(
                    7, "11.19", List.of(), List.of(), List.of(), entry.getKey());
            assertEquals(entry.getValue(), BattlePlaybackProjector.toLoadoutDto(loadout).confidence(),
                    entry.getKey().name());
        }
    }

    private static Path fixture() throws Exception {
        final Path dir = Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures", "replays")
                .normalize();
        try (Stream<Path> s = Files.list(dir)) {
            return s.filter(p -> p.getFileName().toString().contains("random-battle-example"))
                    .findFirst().orElseThrow();
        }
    }

    @Test
    void projectorProducesV2DatasetFromCanonicalTimeline() throws Exception {
        final byte[] bytes = Files.readAllBytes(fixture());
        final Battle battle = ReplayParser.parse(bytes);
        final ReplayReconstruction recon = new ReplayReconstructionService().reconstruct(bytes);
        final PlayerResult recorder = battle.recorderResult();
        assertNotNull(recorder);

        final BattleTimelineResult tl = BattleTimelineBuilder.build(
                battle, recon, TimelinePerspective.personal(
                        recorder.accountId > 0 ? recorder.accountId : null, recorder.team));
        if (recon.battleStartRawClockSec() == null) {
            assertFalse(tl.usable(), "no battle-start authority => fail-closed: " + tl.validation().errors());
            assertTrue(tl.validation().errors().contains(TimelineError.TIMELINE_CLOCK_UNRESOLVED));
            return;
        }
        assertTrue(tl.usable(), "real replay must build timeline: " + tl.validation().errors());
        final BattleTimeline timeline = tl.timeline();
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
        final Long recorderId = recorder.accountId > 0 ? recorder.accountId : null;

        final BattlePlaybackDataset ds = BattlePlaybackProjector.project(battle, timeline, mapping, recorderId);
        assertNotNull(ds, "V2 dataset must build on fixture");
        assertTrue(ds.durationSec() > 0);
        assertTrue(ds.vehicles().size() > 0, "at least one vehicle track");
        assertEquals(battle.players.size(), ds.vehicles().size(),
                "all #301 actual combatants projected as vehicle tracks");

        // 每辆车：identity + position segments + health transitions（canonical projection）
        for (final BattlePlaybackDataset.VehiclePlaybackTrack v : ds.vehicles()) {
            assertTrue(v.accountId() > 0);
            assertFalse(v.positionSegments().isEmpty(), "vehicle must have observed position segments");
        }
        // canonical battle-level events：真实权造成 DAMAGE / DESTROYED / POSITION 事件
        assertTrue(ds.events() != null && !ds.events().isEmpty(),
                "V2 dataset must carry canonical battle-level events (damage/destroyed/position)");
        assertTrue(ds.events().stream().anyMatch(e -> "DAMAGE".equals(e.type())),
                "real fixture must yield at least one DAMAGE event");
        ds.vehicles().stream().flatMap(v -> v.damageLosses().stream()).forEach(loss -> {
            assertTrue(loss.fromSec() >= 0, "loss fromSec=" + loss.fromSec());
            assertTrue(loss.toSec() >= loss.fromSec(), "loss boundary=" + loss.fromSec() + ".." + loss.toSec());
            assertTrue(loss.hpLoss() > 0, "loss hpLoss=" + loss.hpLoss());
            assertTrue(loss.damageEventCount() >= 0, "loss eventCount=" + loss.damageEventCount());
        });
    }

    @Test
    void recorderWinsAsFriendlyTeamAnchor() throws Exception {
        final byte[] bytes = Files.readAllBytes(fixture());
        final Battle battle = ReplayParser.parse(bytes);
        final ReplayReconstruction recon = new ReplayReconstructionService().reconstruct(bytes);
        final PlayerResult recorder = battle.recorderResult();
        final BattleTimelineResult tl = BattleTimelineBuilder.build(
                battle, recon, TimelinePerspective.personal(
                        recorder.accountId > 0 ? recorder.accountId : null, recorder.team));
        if (!tl.usable()) {
            return;
        }
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
        final Long recorderId = recorder.accountId > 0 ? recorder.accountId : null;
        final BattlePlaybackDataset ds = BattlePlaybackProjector.project(
                battle, tl.timeline(), mapping, recorderId);
        assertNotNull(ds);
        assertEquals(recorder.team, ds.friendlyTeam().intValue(), "friendlyTeam must be recorder team");
        assertEquals(recorder.accountId, ds.recorderAccountId().longValue());
        // recorder vehicle is marked friendly=true
        assertTrue(ds.vehicles().stream()
                .filter(v -> v.accountId() == recorder.accountId)
                .findFirst().orElseThrow().friendly());
    }

    @Test
    void canonicalOpeningHealthIsProjectedWithItsDisplayCapacity() {
        final long account = 2001L;
        final int entityId = 7;
        final Battle battle = new Battle();
        battle.mapName = "middleburg";
        battle.durationS = 30.0;
        final PlayerResult friendly = new PlayerResult();
        friendly.accountId = account;
        friendly.team = 1;
        friendly.tankId = 456L;
        friendly.nickname = "Recorder";
        battle.players = new ArrayList<>(List.of(friendly));

        final TeamEntityMapping mapping = new TeamEntityMapping(
                Map.of(entityId, new TeamEntityIdentity(entityId, account, "Recorder", 456L, "Recorder", 1,
                        DecodeConfidence.EXACT)),
                Map.of(account, List.of(entityId)), Map.of(), 0, List.of());
        final FrameVehicle vehicle = new FrameVehicle(
                entityId, account, "Recorder", 456, "Recorder", "Medium tank", 10, 1, true,
                LifeState.ALIVE,
                new FrameHealth(2400, 0.0, 0.0, HpSource.EXACT_BATTLE_EVENT,
                        FrameHealth.HealthKnowledge.CURRENT, 2400, Confidence.HIGH),
                new FramePosition(new Vector3(0, 0, 0), 0.0, 0.0,
                        PositionKnowledge.CURRENT, PositionSource.OBSERVED_EVENT, Confidence.HIGH),
                new FrameOrientation(0f, 0f, 0f, 0.0, 0.0,
                        FrameOrientation.OrientationKnowledge.CURRENT, Confidence.HIGH),
                FrameMapState.UNKNOWN, VehicleKnowledgeState.POSITION_STREAM_ACTIVE, null, List.of());
        final BattleTimeline timeline = new BattleTimeline(
                "middleburg", 30.0, 0.0, BattleTimelineClock.IDENTIFIED,
                List.of(new BattleFrame(0, 0, null, List.of(vehicle), List.of(), List.of(),
                        Map.of(), List.of())), List.of(), List.of(),
                BattleTimelineValidationResult.ok(), List.of());

        final BattlePlaybackDataset dataset = BattlePlaybackProjector.project(battle, timeline, mapping, account);
        final BattlePlaybackDataset.VehiclePlaybackTrack track = dataset.vehicles().getFirst();
        assertEquals(1, track.healthTransitions().size());
        assertEquals(2400, track.healthTransitions().getFirst().currentHp());
        assertEquals(2400, track.healthTransitions().getFirst().displayCapacityHp());
        assertEquals("CURRENT", track.healthTransitions().getFirst().knowledge());
    }

    /**
     * P0 orientation knowledge fix：orientationSegments 必须按每次 frame 的
     * {@code FrameOrientation.knowledge} 分段，绝不得把整条时间轴焊成一个硬编码 "CURRENT" 段。
     * Enemy 以 CURRENT(t=0,1) → LAST_KNOWN(t=2) 观测，应产出两个段且各带正确 knowledge。
     */
    @Test
    void orientationSegmentsSplitByCanonicalKnowledge() {
        final long account = 2001L;
        final int entityId = 7;
        final Battle battle = new Battle();
        battle.mapName = "middleburg";
        battle.durationS = 30.0;
        final PlayerResult enemy = new PlayerResult();
        enemy.accountId = account;
        enemy.team = 2;
        enemy.tankId = 456L;
        enemy.nickname = "Enemy";
        battle.players = new ArrayList<>(List.of(enemy));

        final TeamEntityMapping mapping = new TeamEntityMapping(
                Map.of(entityId, new TeamEntityIdentity(entityId, account, "Enemy", 456L, "Enemy", 2, DecodeConfidence.EXACT)),
                Map.of(account, List.of(entityId)),
                Map.of(), 0, List.of());

        final List<BattleFrame> frames = new ArrayList<>();
        for (int second = 0; second <= 2; second++) {
            final FrameOrientation.OrientationKnowledge k = second < 2
                    ? FrameOrientation.OrientationKnowledge.CURRENT
                    : FrameOrientation.OrientationKnowledge.LAST_KNOWN;
            final FrameVehicle fv = new FrameVehicle(
                    entityId, account, "Enemy", 456, "Enemy", "Medium tank", 10, 2, false,
                    LifeState.ALIVE,
                    new FrameHealth(1000, (double) second, 0.0, HpSource.EXACT_BATTLE_EVENT,
                            FrameHealth.HealthKnowledge.CURRENT, 1000, Confidence.HIGH),
                    new FramePosition(new Vector3(0, 0, (float) second), (double) second, 0.0,
                            PositionKnowledge.CURRENT, PositionSource.OBSERVED_EVENT, Confidence.HIGH),
                    new FrameOrientation(0f, 0f, 0f, (double) second, 0.0, k, Confidence.HIGH),
                    FrameMapState.UNKNOWN, VehicleKnowledgeState.POSITION_STREAM_ACTIVE, null, List.of());
            frames.add(new BattleFrame(second, second, null, List.of(fv), List.of(), List.of(),
                    Map.copyOf(Map.of("second", String.valueOf(second))), List.of()));
        }

        final BattleTimeline timeline = new BattleTimeline(
                "middleburg", 30.0, 0.0, BattleTimelineClock.IDENTIFIED,
                frames, List.of(), List.of(),
                BattleTimelineValidationResult.ok(), List.of());

        final BattlePlaybackDataset ds = BattlePlaybackProjector.project(battle, timeline, mapping, null);
        assertNotNull(ds);
        final BattlePlaybackDataset.VehiclePlaybackTrack track = ds.vehicles().stream()
                .filter(v -> v.accountId() == account).findFirst().orElseThrow();
        assertFalse(track.orientationSegments().isEmpty(), "enemy must have orientation segments");
        assertEquals(2, track.orientationSegments().size(),
                "CURRENT→LAST_KNOWN 应拆成 2 个段，而非 1 个硬编码 CURRENT");
        assertEquals("CURRENT", track.orientationSegments().get(0).knowledge());
        assertEquals("LAST_KNOWN", track.orientationSegments().get(1).knowledge());
    }

    /**
     * P0 consumable hidden-AoI contract：known runtime 在 AoI 关闭（Type4 absent）后必须显式插入
     * UNKNOWN transition，使 hidden 区间查询返回 UNKNOWN（而非残留 ACTIVATED）。
     * 旧实现只收集 observation、不插入 UNKNOWN，本测试在其上失败。
     */
    @Test
    void consumableRuntimeBecomesUnknownAfterAoiCloses() {
        final long account = 2001L;
        final int entityId = 7;
        final Battle battle = new Battle();
        battle.mapName = "middleburg";
        battle.durationS = 30.0;
        final PlayerResult enemy = new PlayerResult();
        enemy.accountId = account;
        enemy.team = 2;
        enemy.tankId = 456L;
        enemy.nickname = "Enemy";
        battle.players = new ArrayList<>(List.of(enemy));

        final TeamEntityMapping mapping = new TeamEntityMapping(
                Map.of(entityId, new TeamEntityIdentity(entityId, account, "Enemy", 456L, "Enemy", 2, DecodeConfidence.EXACT)),
                Map.of(account, List.of(entityId)),
                Map.of(), 0, List.of());

        // timeline：敌方 AoI 观测段 [0,20)（Type4 absent=20 → hidden）；consumable ACTIVATED @12s，
        // 之后 TEARDOWN @25s。canonical truth：12-20 ACTIVATED，20-25 UNKNOWN，25+ TEARDOWN。
        final com.wotb.core.replay.event.ConsumableLifecycleEvent activate =
                new com.wotb.core.replay.event.ConsumableLifecycleEvent(
                        1, new com.wotb.core.replay.event.ReplayTimestamp(12f, 12f), 32,
                        DecodeConfidence.EXACT, entityId, 12f, 0x0D, "REPAIR_KIT",
                        com.wotb.core.replay.event.ConsumableLifecycleEvent.ConsumableLifecycleState.ACTIVATED,
                        0, 0f);
        final com.wotb.core.replay.event.ConsumableLifecycleEvent teardown =
                new com.wotb.core.replay.event.ConsumableLifecycleEvent(
                        2, new com.wotb.core.replay.event.ReplayTimestamp(25f, 25f), 32,
                        DecodeConfidence.EXACT, entityId, 25f, 0x0D, "REPAIR_KIT",
                        com.wotb.core.replay.event.ConsumableLifecycleEvent.ConsumableLifecycleState.TEARDOWN,
                        0, 0f);
        final java.util.List<com.wotb.core.replay.event.ReplayEvent> events =
                new ArrayList<>(List.of(activate, teardown));

        final List<BattleFrame> frames = new ArrayList<>();
        for (int second = 0; second <= 2; second++) {
            final FrameVehicle fv = new FrameVehicle(
                    entityId, account, "Enemy", 456, "Enemy", "Medium tank", 10, 2, false,
                    LifeState.ALIVE,
                    new FrameHealth(1000, (double) second, 0.0, HpSource.EXACT_BATTLE_EVENT,
                            FrameHealth.HealthKnowledge.CURRENT, 1000, Confidence.HIGH),
                    new FramePosition(new Vector3(0, 0, (float) second), (double) second, 0.0,
                            PositionKnowledge.CURRENT, PositionSource.OBSERVED_EVENT, Confidence.HIGH),
                    new FrameOrientation(0f, 0f, 0f, (double) second, 0.0,
                            FrameOrientation.OrientationKnowledge.CURRENT, Confidence.HIGH),
                    FrameMapState.UNKNOWN, VehicleKnowledgeState.POSITION_STREAM_ACTIVE, null, List.of());
            frames.add(new BattleFrame(second, second, null, List.of(fv), List.of(), List.of(),
                    Map.copyOf(Map.of("second", String.valueOf(second))), List.of()));
        }
        // AoI 观测段：observedFrom=0, absentFrom=20（closed → hidden）。
        final java.util.List<AoiObservationSegment> aoi = List.of(
                new AoiObservationSegment(entityId, 0.0, 20.0, "REPLAY_POV"));

        final BattleTimeline timeline = new BattleTimeline(
                "middleburg", 30.0, 0.0, BattleTimelineClock.IDENTIFIED,
                frames, events, aoi,
                BattleTimelineValidationResult.ok(), List.of());

        final BattlePlaybackDataset ds = BattlePlaybackProjector.project(battle, timeline, mapping, null);
        assertNotNull(ds);
        final BattlePlaybackDataset.VehiclePlaybackTrack track = ds.vehicles().stream()
                .filter(v -> v.accountId() == account).findFirst().orElseThrow();
        // 用前端同构的 lastAtOrBefore 解析三个时间点状态（anti-future-leak）。
        assertEquals("ACTIVATED", stateAt(track.consumableTransitions(), 19.0),
                "close 前（<=20 事实）必须仍是 ACTIVATED");
        assertEquals("UNKNOWN", stateAt(track.consumableTransitions(), 22.0),
                "AoI close @20 必须插入 explicit UNKNOWN，隐区间查询为 UNKNOWN，不得残留 ACTIVATED");
        assertEquals("TEARDOWN", stateAt(track.consumableTransitions(), 26.0),
                "后续 TEARDOWN @25 必须覆盖 UNKNOWN（25+ = TEARDOWN）");
    }

    @Test
    void preBattleConsumableIsSeededAtZeroAndSupremacyPointsDropNegativeSamples() {
        final long account = 2001L;
        final int entityId = 7;
        final Battle battle = new Battle();
        battle.mapName = "middleburg";
        battle.durationS = 30.0;
        final PlayerResult enemy = new PlayerResult();
        enemy.accountId = account;
        enemy.team = 2;
        enemy.tankId = 456L;
        enemy.nickname = "Enemy";
        battle.players = new ArrayList<>(List.of(enemy));

        final TeamEntityMapping mapping = new TeamEntityMapping(
                Map.of(entityId, new TeamEntityIdentity(entityId, account, "Enemy", 456L, "Enemy", 2,
                        DecodeConfidence.EXACT)),
                Map.of(account, List.of(entityId)), Map.of(), 0, List.of());
        final List<com.wotb.core.replay.event.ReplayEvent> events = new ArrayList<>();
        events.add(new com.wotb.core.replay.event.ConsumableLifecycleEvent(
                1, new com.wotb.core.replay.event.ReplayTimestamp(-5f, -5f), 32,
                DecodeConfidence.EXACT, entityId, -5f, 0x0D, "REPAIR_KIT",
                com.wotb.core.replay.event.ConsumableLifecycleEvent.ConsumableLifecycleState.INITIALIZED,
                0, 0f));
        events.add(new com.wotb.core.replay.event.ConsumableLifecycleEvent(
                5, new com.wotb.core.replay.event.ReplayTimestamp(-9f, -9f), 32,
                DecodeConfidence.EXACT, entityId, -9f, 0x0D, null,
                com.wotb.core.replay.event.ConsumableLifecycleEvent.ConsumableLifecycleState.INITIALIZED,
                0, 0f));
        events.add(new com.wotb.core.replay.event.ConsumableLifecycleEvent(
                6, new com.wotb.core.replay.event.ReplayTimestamp(-4f, -4f), 32,
                DecodeConfidence.EXACT, entityId, -4f, 0x09, "ADRENALINE",
                com.wotb.core.replay.event.ConsumableLifecycleEvent.ConsumableLifecycleState.INITIALIZED,
                0, 0f));
        events.add(new com.wotb.core.replay.event.ConsumableLifecycleEvent(
                7, new com.wotb.core.replay.event.ReplayTimestamp(8f, 8f), 32,
                DecodeConfidence.EXACT, entityId, 8f, 0x0D, "REPAIR_KIT",
                com.wotb.core.replay.event.ConsumableLifecycleEvent.ConsumableLifecycleState.INITIALIZED,
                0, 0f));
        events.add(new com.wotb.core.replay.event.SupremacyPointsChangedEvent(
                2, new com.wotb.core.replay.event.ReplayTimestamp(-4f, -4f), 8,
                DecodeConfidence.EXACT, 1, 120));
        events.add(new com.wotb.core.replay.event.SupremacyPointsChangedEvent(
                3, new com.wotb.core.replay.event.ReplayTimestamp(-3f, -3f), 8,
                DecodeConfidence.EXACT, 2, 80));
        events.add(new com.wotb.core.replay.event.SupremacyPointsChangedEvent(
                4, new com.wotb.core.replay.event.ReplayTimestamp(10f, 10f), 8,
                DecodeConfidence.EXACT, 1, 140));

        final BattleTimeline timeline = new BattleTimeline(
                "middleburg", 30.0, 0.0, BattleTimelineClock.IDENTIFIED,
                List.of(), events, List.of(), BattleTimelineValidationResult.ok(), List.of());
        final BattlePlaybackDataset dataset = BattlePlaybackProjector.project(battle, timeline, mapping, null);
        assertNotNull(dataset);

        final BattlePlaybackDataset.VehiclePlaybackTrack track = dataset.vehicles().getFirst();
        assertEquals(0d, track.consumableTransitions().getFirst().timeSec(), 1e-9);
        assertEquals("INITIALIZED", track.consumableTransitions().getFirst().state());
        assertEquals(2, track.consumableTransitions().stream()
                .filter(t -> t.timeSec() == 0d).count(),
                "same entity+wireCode duplicate pre-battle INITIALIZED records must yield one seed");
        assertEquals(1, track.consumableTransitions().stream()
                .filter(t -> t.timeSec() == 0d && t.wireCode() == 0x0D).count());
        assertEquals(1, track.consumableTransitions().stream()
                .filter(t -> t.timeSec() == 0d && t.wireCode() == 0x09).count());
        assertEquals(1, track.consumableTransitions().stream()
                .filter(t -> t.timeSec() == 8d && t.wireCode() == 0x0D).count(),
                "post-start rematerialization remains a distinct transition");
        assertEquals(7, timeline.events().size(), "canonical raw evidence remains intact");
        assertTrue(dataset.events().stream().allMatch(e -> e.timeSec() >= 0d));
        assertTrue(dataset.pointsSamples().stream().allMatch(s -> s.timeSec() >= 0d));
        assertEquals(120, dataset.pointsSamples().stream()
                .filter(s -> s.team() == 1 && s.timeSec() == 0d)
                .findFirst().orElseThrow().points());
        assertEquals(80, dataset.pointsSamples().stream()
                .filter(s -> s.team() == 2 && s.timeSec() == 0d)
                .findFirst().orElseThrow().points());
    }

    /** 与前端 lastAtOrBefore 同构：返回 timeSec <= t 的最近一个 transition 的 state。 */
    private static String stateAt(final List<BattlePlaybackDataset.ConsumableTransition> transitions,
                                  final double t) {
        BattlePlaybackDataset.ConsumableTransition last = null;
        // transitions 已按 timeSec 升序（projector 已排序）
        for (final BattlePlaybackDataset.ConsumableTransition tr : transitions) {
            if (tr.timeSec() <= t + 1e-6) {
                last = tr;
            } else {
                break;
            }
        }
        return last == null ? "UNKNOWN" : last.state();
    }
}
