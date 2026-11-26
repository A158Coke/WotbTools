package com.wotb.core.replay.timeline;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BattleTimelineDurationTest {

    private static final double START = TimelineTestFixtures.START_RAW;
    private static final double EPS = 1e-3;

    private static Battle metaOnlyBattle(final Double metaDurationSec) {
        final Battle b = TimelineTestFixtures.battle(0.0);
        b.durationS = metaDurationSec;
        b.settlementDurationSec = null;
        return b;
    }

    private static Battle settlementBattle(final double settlementSec) {
        final Battle b = TimelineTestFixtures.battle(Math.min(settlementSec, 420));
        b.settlementDurationSec = settlementSec;
        return b;
    }

    private static List<ReplayEvent> eventsWithRoundFinished(final double roundFinishedSec) {
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.position(TimelineTestFixtures.RECORDER_EID, 45, 12f, 12f, 0f));
        events.add(TimelineTestFixtures.battleEnded(roundFinishedSec));
        return events;
    }

    @Test
    void settlementRoot5WinsOverRoundFinishedAndMeta() {
        final Battle battle = settlementBattle(150.0);
        final ReplayReconstruction recon =
                TimelineTestFixtures.recon(300.0, eventsWithRoundFinished(120.0));

        assertEquals(150.0, TimelineClockResolver.resolveDurationSec(battle, recon, START), EPS);
    }

    @Test
    void settlementRoot5IsCappedAt420() {
        final Battle battle = settlementBattle(500.0);
        final ReplayReconstruction recon =
                TimelineTestFixtures.recon(500.0, eventsWithRoundFinished(120.0));

        assertEquals(420.0, TimelineClockResolver.resolveDurationSec(battle, recon, START), EPS);
    }

    @Test
    void roundFinishedWinsOverInflatedMetaDuration() {
        final Battle battle = metaOnlyBattle(300.0);
        final ReplayReconstruction recon =
                TimelineTestFixtures.recon(300.0, eventsWithRoundFinished(180.0));

        assertEquals(180.0, TimelineClockResolver.resolveDurationSec(battle, recon, START), EPS);
    }

    @Test
    void roundFinishedWinsWithoutAnyDurationSource() {
        final Battle battle = metaOnlyBattle(null);
        final ReplayReconstruction recon =
                TimelineTestFixtures.recon(0.0, eventsWithRoundFinished(95.5));

        assertEquals(95.5, TimelineClockResolver.resolveDurationSec(battle, recon, START), EPS);
    }

    @Test
    void roundFinishedAtOrBeforeBattleStartIsIgnoredAndMetaFallbackUsed() {
        final Battle battle = metaOnlyBattle(240.0);
        final ReplayReconstruction recon =
                TimelineTestFixtures.recon(240.0, eventsWithRoundFinished(-5.0));

        assertEquals(240.0, TimelineClockResolver.resolveDurationSec(battle, recon, START), EPS);
    }

    @Test
    void metaFallbackUsedWhenNoRoundFinishedAndCappedAt420() {
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        assertEquals(240.0, TimelineClockResolver.resolveDurationSec(
                metaOnlyBattle(240.0), TimelineTestFixtures.recon(240.0, events), START), EPS);
        assertEquals(420.0, TimelineClockResolver.resolveDurationSec(
                metaOnlyBattle(600.0), TimelineTestFixtures.recon(600.0, events), START), EPS);
    }

    @Test
    void lastEventTimeIsFinalFallback() {
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.position(TimelineTestFixtures.RECORDER_EID, 45, 12f, 12f, 0f));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(0.0, events);

        assertEquals(45.0, TimelineClockResolver.resolveDurationSec(metaOnlyBattle(null), recon, START), EPS);
    }

    @Test
    void builtTimelineEndsAtRoundFinishedWhenMetaIsInflated() {
        final Battle battle = metaOnlyBattle(300.0);
        final ReplayReconstruction recon =
                TimelineTestFixtures.recon(300.0, eventsWithRoundFinished(180.0));

        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        assertNotNull(timeline);
        assertTrue(timeline.validation().valid());
        assertEquals(180.0, timeline.durationSec(), EPS);
        assertEquals(181, timeline.frames().size());
    }
}
