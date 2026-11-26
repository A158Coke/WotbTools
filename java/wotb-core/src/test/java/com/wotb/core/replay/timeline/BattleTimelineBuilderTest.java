package com.wotb.core.replay.timeline;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.reconstruction.ReplayStreamHeader;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.LifeState;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayMetadata;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayStreamDiagnostics;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BattleTimelineBuilderTest {

    @Test
    void buildsDeterministicFramesWithBattleRelativeBoundaries() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.damage(TimelineTestFixtures.RECORDER_EID,
                TimelineTestFixtures.ENEMY_EID, 1.5, 420));
        events.add(TimelineTestFixtures.damage(TimelineTestFixtures.RECORDER_EID,
                TimelineTestFixtures.ENEMY_EID, 2.5, 100));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);

        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        assertNotNull(timeline);
        assertTrue(timeline.validation().valid());
        assertEquals(61, timeline.frames().size());
        assertEquals(0, timeline.frames().get(0).second());
        assertEquals(60, timeline.frames().get(timeline.frames().size() - 1).second());

        final BattleFrame frame2 = timeline.frameAt(2);
        assertEquals(1, frame2.events().size());
        assertEquals(420, ((com.wotb.core.replay.event.DamageEvent) frame2.events().get(0)).damage());
        assertEquals(1, timeline.frameAt(3).events().stream()
                .filter(e -> !(e instanceof PositionChangedEvent)).count());

        final BattleTimeline again = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();
        assertEquals(timeline.frames().size(), again.frames().size());
        assertEquals(timeline.frames().get(30).world(), again.frames().get(30).world());
    }

    @Test
    void type5OpeningHpSeedsTheActiveBattleFrame() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.removeIf(event -> event instanceof HealthChangedEvent health
                && health.entityId() == TimelineTestFixtures.ENEMY2_EID);
        events.add(new com.wotb.core.replay.event.MaterializationEvent(
                ++TimelineTestFixtures.seq,
                TimelineTestFixtures.ts(-2),
                5,
                DecodeConfidence.EXACT,
                TimelineTestFixtures.ENEMY2_EID,
                2,
                2400,
                new byte[8],
                new byte[0]));

        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        final FrameVehicle atStart = vehicleAt(timeline, TimelineTestFixtures.ENEMY2_EID, 0);
        assertNotNull(atStart.health());
        assertEquals(2400, atStart.health().currentHp());
        assertEquals(FrameHealth.HealthKnowledge.CURRENT, atStart.health().knowledge());
        assertEquals(2400, atStart.health().displayCapacityHp());
    }

    @Test
    void enemyKnowledgeStaysActiveAcrossQuietGapWithinOpenObservedSegment() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.position(TimelineTestFixtures.ENEMY_EID, 10, -12f, -12f, 0f));
        events.add(TimelineTestFixtures.position(TimelineTestFixtures.ENEMY_EID, 25, -14f, -14f, 0f));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        assertEquals(VehicleKnowledgeState.POSITION_STREAM_ACTIVE,
                vehicleAt(timeline, TimelineTestFixtures.ENEMY_EID, 10).knowledgeState());
        assertEquals(VehicleKnowledgeState.POSITION_STREAM_ACTIVE,
                vehicleAt(timeline, TimelineTestFixtures.ENEMY_EID, 15).knowledgeState());
        assertEquals(VehicleKnowledgeState.POSITION_STREAM_ACTIVE,
                vehicleAt(timeline, TimelineTestFixtures.ENEMY_EID, 20).knowledgeState());
        final FrameVehicle at25 = vehicleAt(timeline, TimelineTestFixtures.ENEMY_EID, 25);
        assertEquals(VehicleKnowledgeState.POSITION_STREAM_ACTIVE, at25.knowledgeState());
        assertEquals(PositionKnowledge.CURRENT, at25.position().knowledge());
        assertNotNull(at25.position().position());
        final BattleTimeline again = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();
        assertEquals(timeline.aoiSegments(), again.aoiSegments(), "AoI segments 必须确定性一致");
    }

    @Test
    void enemyKnowledgeIsLastKnownAcrossLeaveReentryGap() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.position(TimelineTestFixtures.ENEMY_EID, 10, -12f, -12f, 0f));
        events.add(new com.wotb.core.replay.event.EntityRemovedEvent(++TimelineTestFixtures.seq,
                TimelineTestFixtures.ts(20), 4, DecodeConfidence.EXACT, TimelineTestFixtures.ENEMY_EID));
        events.add(new com.wotb.core.replay.event.MaterializationEvent(
                ++TimelineTestFixtures.seq, TimelineTestFixtures.ts(31), 5,
                DecodeConfidence.EXACT, TimelineTestFixtures.ENEMY_EID, 2, null,
                new byte[0], new byte[0]));
        events.add(TimelineTestFixtures.position(TimelineTestFixtures.ENEMY_EID, 32, -16f, -16f, 0f));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        assertEquals(VehicleKnowledgeState.POSITION_STREAM_ACTIVE,
                vehicleAt(timeline, TimelineTestFixtures.ENEMY_EID, 15).knowledgeState());
        final FrameVehicle at25 = vehicleAt(timeline, TimelineTestFixtures.ENEMY_EID, 25);
        assertEquals(VehicleKnowledgeState.LAST_KNOWN, at25.knowledgeState());
        assertEquals(PositionKnowledge.LAST_KNOWN, at25.position().knowledge());
        assertNotNull(at25.position().position());
        assertEquals(15.0, at25.position().positionAgeSec(), 1e-9);
        assertEquals(PositionSource.CARRIED_FORWARD, at25.position().source());
        assertEquals(VehicleKnowledgeState.POSITION_STREAM_ACTIVE,
                vehicleAt(timeline, TimelineTestFixtures.ENEMY_EID, 35).knowledgeState());
    }

    @Test
    void friendlyPositionCarriesForwardBeyondStalenessGap() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        final FrameVehicle at20 = vehicleAt(timeline, TimelineTestFixtures.FRIENDLY_EID, 20);
        assertEquals(VehicleKnowledgeState.POSITION_STREAM_ACTIVE, at20.knowledgeState());
        assertEquals(PositionKnowledge.CURRENT, at20.position().knowledge());
        assertNotNull(at20.position().position());
        assertEquals(20.0, at20.position().positionAgeSec(), 1e-9);
        assertEquals(PositionSource.CARRIED_FORWARD, at20.position().source());
    }

    @Test
    void destroyedKnownIsWorldFactAtTimeAndOverridesPositionKnowledge() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.health(TimelineTestFixtures.ENEMY_EID, 30, 0, false));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        final FrameVehicle at25 = vehicleAt(timeline, TimelineTestFixtures.ENEMY_EID, 25);
        assertFalse(at25.lifeState() == LifeState.DESTROYED);
        assertNull(at25.destroyedKnownAtSec());
        final FrameVehicle at35 = vehicleAt(timeline, TimelineTestFixtures.ENEMY_EID, 35);
        assertEquals(LifeState.DESTROYED, at35.lifeState());
        assertEquals(VehicleKnowledgeState.DESTROYED_KNOWN, at35.knowledgeState());
        assertEquals(30.0, at35.destroyedKnownAtSec(), 1e-9);
    }

    @Test
    void worldSummaryCountsEnemyKnowledgeAndUnknown() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.position(TimelineTestFixtures.ENEMY_EID, 10, -12f, -12f, 0f));
        events.add(TimelineTestFixtures.position(TimelineTestFixtures.ENEMY2_EID, 50, -25f, -25f, 0f));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        final WorldSummary world = timeline.frameAt(40).world();
        assertEquals(2, world.friendlyTotal());
        assertEquals(2, world.friendlyAlive());
        assertEquals(2, world.enemyTotal());
        assertEquals(2, world.enemyKnown());
        assertEquals(0, world.enemyLastKnown());
        assertEquals(0, world.enemyUnknown());
        assertEquals(2, timeline.frameAt(55).world().enemyKnown());
        assertEquals(0, timeline.frameAt(55).world().enemyLastKnown());
        assertEquals(2, world.enemyAlive());
    }

    @Test
    void enemyKnowledgePartitionIsExclusiveAndDestroyedCountedOnce() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.position(TimelineTestFixtures.ENEMY_EID, 55, -12f, -12f, 0f));
        events.add(TimelineTestFixtures.position(TimelineTestFixtures.ENEMY2_EID, 55, -25f, -25f, 0f));
        events.add(TimelineTestFixtures.health(TimelineTestFixtures.ENEMY2_EID, 20, 0, false));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        final WorldSummary before = timeline.frameAt(10).world();
        assertEquals(2, before.enemyAlive(), "阵亡前敌方 2 车存活");
        assertEquals(2, before.enemyKnown() + before.enemyLastKnown()
                + before.enemyUnknown() + before.enemyDestroyedKnown(),
                "knowledge partition 必须等于 enemyTotal");

        final WorldSummary after = timeline.frameAt(30).world();
        assertEquals(1, after.enemyAlive(), "一辆敌车阵亡只减少一个 enemyAlive");
        assertEquals(1, after.enemyDestroyedKnown(), "destroyed 只计一次");
        assertEquals(2, after.enemyKnown() + after.enemyLastKnown()
                + after.enemyUnknown() + after.enemyDestroyedKnown(),
                "knowledge partition 必须等于 enemyTotal（互斥、无重复）");
        assertEquals(0, after.enemyUnknown());
    }

    @Test
    void nullTimestampEventsAreExcludedNotBucketedIntoFrameZero() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(new com.wotb.core.replay.event.DamageEvent(
                999, null, 8, DecodeConfidence.EXACT,
                TimelineTestFixtures.RECORDER_EID, TimelineTestFixtures.ENEMY_EID,
                null, null, 420, false));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);
        final BattleTimelineResult result = BattleTimelineBuilder.build(
                battle, recon, TimelineTestFixtures.personalPerspective());
        assertTrue(result.usable());
        final BattleTimeline timeline = result.timeline();
        assertTrue(timeline.events().stream().noneMatch(e -> e.sequence() == 999),
                "null timestamp 事件不得进入 timeline");
        assertTrue(timeline.frameAt(0).events().stream().noneMatch(e -> e.sequence() == 999),
                "null timestamp 事件不得被塞进 frame 0");
    }

    @Test
    void preBattleEventsRemainInCanonicalStreamButNotInActiveFrameZero() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(new com.wotb.core.replay.event.DamageEvent(
                999, TimelineTestFixtures.ts(-5), 8, DecodeConfidence.EXACT,
                TimelineTestFixtures.RECORDER_EID, TimelineTestFixtures.ENEMY_EID,
                null, null, 420, false));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);

        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        assertTrue(timeline.events().stream().anyMatch(e -> e.sequence() == 999),
                "canonical stream must retain pre-battle evidence");
        assertTrue(timeline.frameAt(0).events().stream().noneMatch(e -> e.sequence() == 999),
                "pre-battle evidence must not become an active frame-0 event");
    }

    @Test
    void clockEstimatedFallbackWhenNoBattleStartIdentified() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.battleEnded(60.0));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);
        final ReplayReconstruction noStart = new ReplayReconstruction(
                recon.metadata(), recon.streamHeader(), recon.battleDurationSec(), null,
                recon.participants(), recon.events(), recon.checkpoints(),
                recon.finalState(), recon.coverage(), recon.diagnostics());

        final BattleTimelineResult result =
                BattleTimelineBuilder.build(battle, noStart, TimelineTestFixtures.personalPerspective());
        assertTrue(result.usable());
        assertEquals(BattleTimelineClock.ESTIMATED, result.timeline().clockResolution());
        assertTrue(result.timeline().limitations().contains("CLOCK_ESTIMATED"));
    }

    @Test
    void frameEventsKeepPreciseTimestamps() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.health(TimelineTestFixtures.ENEMY_EID, 10.7, 1200, true));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        final BattleFrame frame11 = timeline.frameAt(11);
        final HealthChangedEvent hp = frame11.events().stream()
                .filter(HealthChangedEvent.class::isInstance)
                .map(HealthChangedEvent.class::cast)
                .filter(e -> e.entityId() == TimelineTestFixtures.ENEMY_EID)
                .findFirst().orElse(null);
        assertNotNull(hp);
        assertEquals(10.7, TimelineClock.battleClockOf(hp, timeline.battleStartRawClockSec()), 1e-3);
        assertFalse(timeline.frameAt(10).events().stream()
                .anyMatch(e -> e instanceof HealthChangedEvent
                        && ((HealthChangedEvent) e).entityId() == TimelineTestFixtures.ENEMY_EID));
    }

    @Test
    void canonicalTimelineExcludesNonCombatantPositionEntity() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.created(99, 0));
        events.add(TimelineTestFixtures.position(99, 5, 100f, 100f, 0f));
        events.add(TimelineTestFixtures.position(99, 10, 105f, 100f, 0f));
        events.add(TimelineTestFixtures.position(99, 25, 500f, 500f, 0f));
        events.add(TimelineTestFixtures.position(99, 30, 505f, 500f, 0f));
        events.add(TimelineTestFixtures.position(99, 50, 600f, 600f, 0f));
        events.add(TimelineTestFixtures.health(99, 35, 0, false));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(60.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();
        assertNotNull(timeline);

        for (final BattleFrame frame : timeline.frames()) {
            assertTrue(frame.vehicles().stream().noneMatch(v -> v.entityId() == 99),
                    "spectator entity 99 不得进入 tactical FrameVehicle: frame " + frame.second());
        }
        for (final BattleFrame frame : timeline.frames()) {
            assertTrue(frame.deltas().stream().noneMatch(d -> d.entityId() != null && d.entityId() == 99),
                    "spectator entity 99 不得产生 tactical delta: frame " + frame.second());
        }
        for (final BattleFrame frame : timeline.frames()) {
            assertEquals(2, frame.world().friendlyTotal(), "frame " + frame.second());
            assertEquals(2, frame.world().enemyTotal(), "frame " + frame.second());
            assertEquals(2, frame.world().enemyAlive(),
                    "spectator 阵亡不得减少 enemyAlive: frame " + frame.second());
        }
    }

    @Test
    void nonCombatantWithUsableBroadRosterIdentityStillExcluded() {
        final Battle battle = TimelineTestFixtures.battle(60.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.mapping(99, 9999L));
        events.add(TimelineTestFixtures.created(99, 0));
        events.add(TimelineTestFixtures.position(99, 5, 100f, 100f, 0f));
        events.add(TimelineTestFixtures.position(99, 10, 105f, 100f, 0f));
        events.add(TimelineTestFixtures.position(99, 25, 500f, 500f, 0f));
        events.add(TimelineTestFixtures.position(99, 50, 600f, 600f, 0f));
        events.add(TimelineTestFixtures.health(99, 35, 0, false));
        final ReplayReconstruction recon = reconWithParticipants(60.0, events,
                List.of(new BattleParticipant(9999L, "SpectatorCam", 2, 9489, "E 100", false)));
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();
        assertNotNull(timeline, "broad-roster spectator 必须被 #301 过滤，timeline 仍可用");

        for (final BattleFrame frame : timeline.frames()) {
            assertTrue(frame.vehicles().stream().noneMatch(v -> v.entityId() == 99),
                    "usable broad-roster 身份的 spectator 仍不得进入 FrameVehicle: frame " + frame.second());
            assertTrue(frame.deltas().stream().noneMatch(d -> d.entityId() != null && d.entityId() == 99),
                    "usable broad-roster 身份的 spectator 不得产生 tactical delta: frame " + frame.second());
            assertEquals(2, frame.world().friendlyTotal(), "frame " + frame.second());
            assertEquals(2, frame.world().enemyTotal(),
                    "broad-roster spectator(team=2) 不得把 enemyTotal 从 2 撑到 3: frame " + frame.second());
        }
    }

    private static ReplayReconstruction reconWithParticipants(
            final double durationSec,
            final List<ReplayEvent> events,
            final List<BattleParticipant> participants) {
        final ReplayMetadata meta = new ReplayMetadata(
                "arena", "middleburg", "1", "1", 1, "rec1", "", durationSec, 0L);
        final ReplayStreamHeader header = new ReplayStreamHeader(
                0x12345678L, new byte[8], "h", "v", 15);
        final ReplayCoverage coverage = new ReplayCoverage(1, 1, 0, 0, 0, 1.0, Map.of());
        final ReplayStreamDiagnostics diag = new ReplayStreamDiagnostics(0, 0, 0f, 0f, 0, Map.of());
        final BattleStateSnapshot finalState = BattleStateSnapshot.empty();
        return new ReplayReconstruction(
                meta, header, (float) durationSec, TimelineTestFixtures.START_RAW,
                participants, List.copyOf(events), List.of(), finalState, coverage, diag);
    }

    private static FrameVehicle vehicleAt(final BattleTimeline timeline, final int eid, final int second) {
        return timeline.frameAt(second).vehicles().stream()
                .filter(v -> v.entityId() == eid)
                .findFirst().orElse(null);
    }
}
