package com.wotb.core.replay.timeline;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.EntityRemovedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BattleTimelineAntiFutureLeakTest {

    private static final int ENEMY = TimelineTestFixtures.ENEMY_EID;

    @Test
    void contextBeforeReacquireMustNotSeeFutureHp() {
        final Battle battle = TimelineTestFixtures.battle(200.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.position(ENEMY, 100, -12f, -12f, 0f));
        events.add(new EntityRemovedEvent(TimelineTestFixtures.seq++, TimelineTestFixtures.ts(100),
                4, DecodeConfidence.EXACT, ENEMY));
        events.add(TimelineTestFixtures.health(ENEMY, 100, 1500, true));
        events.add(TimelineTestFixtures.position(ENEMY, 140, -15f, -15f, 0f));
        events.add(TimelineTestFixtures.health(ENEMY, 140, 600, true));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(200.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();
        assertNotNull(timeline);

        final FrameVehicle at120 = frameVehicle(timeline, 120);
        assertEquals(VehicleKnowledgeState.LAST_KNOWN, at120.knowledgeState());
        assertEquals(1500, at120.health().currentHp());
        assertEquals(100.0, at120.health().observedAtSec(), 1e-9);
        assertEquals(20.0, at120.health().ageSec(), 1e-9);
        assertEquals(FrameHealth.HealthKnowledge.LAST_KNOWN, at120.health().knowledge());
        assertEquals(1500, at120.health().displayCapacityHp(),
                "displayCapacityHp must be anti-future-leak: only <=120s obs, never 600 from t=140");

        assertEquals(1500, frameVehicle(timeline, 130).health().currentHp());

        final FrameVehicle at145 = frameVehicle(timeline, 145);
        assertEquals(600, at145.health().currentHp());
        assertEquals(VehicleKnowledgeState.POSITION_STREAM_ACTIVE, at145.knowledgeState());
        assertEquals(FrameHealth.HealthKnowledge.CURRENT, at145.health().knowledge());
        assertEquals(1500, at145.health().displayCapacityHp());
    }

    @Test
    void reacquireProducesBoundedRetrospectiveHpGapDelta() {
        final Battle battle = TimelineTestFixtures.battle(200.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.position(ENEMY, 100, -12f, -12f, 0f));
        events.add(new EntityRemovedEvent(TimelineTestFixtures.seq++, TimelineTestFixtures.ts(100),
                4, DecodeConfidence.EXACT, ENEMY));
        events.add(TimelineTestFixtures.health(ENEMY, 100, 1500, true));
        events.add(TimelineTestFixtures.position(ENEMY, 140, -15f, -15f, 0f));
        events.add(TimelineTestFixtures.health(ENEMY, 140, 600, true));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(200.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        final BattleFrame frame140 = timeline.frameAt(140);
        final BattleDelta gap = frame140.deltas().stream()
                .filter(d -> d.kind() == DeltaKind.HP_GAP_DELTA)
                .findFirst().orElse(null);
        assertNotNull(gap, "expected HP_GAP_DELTA at frame 140");
        assertEquals(1500, gap.number("previousKnownHp", -1), 1e-9);
        assertEquals(600, gap.number("newKnownHp", -1), 1e-9);
        assertEquals(-900, gap.number("hpDelta", 0), 1e-9);
        assertEquals(40.0, gap.number("informationGapSec", -1), 1e-9);
        assertEquals("true", gap.attr("exactCauseUnknown", "false"));

        assertTrue(timeline.frameAt(120).deltas().stream()
                .noneMatch(d -> d.kind() == DeltaKind.HP_GAP_DELTA));
    }

    @Test
    void futureDestroyedStateDoesNotLeakIntoPastFrames() {
        final Battle battle = TimelineTestFixtures.battle(200.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.health(ENEMY, 150, 0, false));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(200.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        final FrameVehicle at120 = frameVehicle(timeline, 120);
        assertNull(at120.destroyedKnownAtSec());
        assertTrue(at120.knowledgeState() != VehicleKnowledgeState.DESTROYED_KNOWN);
        assertNotNull(frameVehicle(timeline, 160).destroyedKnownAtSec());
        assertEquals(150.0, frameVehicle(timeline, 160).destroyedKnownAtSec(), 1e-9);
    }

    @Test
    void orientationKnowledgeIsLastKnownDuringAoIHiddenInterval() {
        final Battle battle = TimelineTestFixtures.battle(200.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.position(ENEMY, 100, -12f, -12f, 0f));
        events.add(TimelineTestFixtures.turret(ENEMY, 100, 30.0));
        events.add(new EntityRemovedEvent(TimelineTestFixtures.seq++, TimelineTestFixtures.ts(100),
                4, DecodeConfidence.EXACT, ENEMY));
        events.add(TimelineTestFixtures.position(ENEMY, 140, -15f, -15f, 0f));
        events.add(TimelineTestFixtures.turret(ENEMY, 140, 45.0));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(200.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();
        assertNotNull(timeline);

        final FrameVehicle at120 = frameVehicle(timeline, 120);
        assertNotNull(at120.orientation().hullYawDeg());
        assertEquals(FrameOrientation.OrientationKnowledge.LAST_KNOWN,
                at120.orientation().knowledge());
        final FrameVehicle at145 = frameVehicle(timeline, 145);
        assertEquals(FrameOrientation.OrientationKnowledge.CURRENT,
                at145.orientation().knowledge());
    }

    private static FrameVehicle frameVehicle(final BattleTimeline timeline, final int second) {
        return timeline.frameAt(second).vehicles().stream()
                .filter(v -> v.entityId() == ENEMY)
                .findFirst().orElse(null);
    }
}
