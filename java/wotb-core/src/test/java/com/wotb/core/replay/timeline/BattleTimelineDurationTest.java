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

/**
 * Timeline/playback {@code durationSec} 权威链：settlement root5 → round-finished − battle 开始 →
 * legacy meta durationS → 最后事件时间（docs/features/battle-playback.md「时长契约」）。
 */
class BattleTimelineDurationTest {

    private static final double START = TimelineTestFixtures.START_RAW;
    private static final double EPS = 1e-3;

    /** 无 settlement：durationS 视为已退役 Java {@code ReplayParser} 的 meta.json#battleDuration fallback
     * （客户端同口径见 {@code frontend/src/replay-local/battleFacts.ts}）。 */
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

        assertEquals(150.0, BattleTimelineBuilder.resolveDurationSec(battle, recon, START), EPS);
    }

    @Test
    void settlementRoot5IsCappedAt420() {
        final Battle battle = settlementBattle(500.0);
        final ReplayReconstruction recon =
                TimelineTestFixtures.recon(500.0, eventsWithRoundFinished(120.0));

        assertEquals(420.0, BattleTimelineBuilder.resolveDurationSec(battle, recon, START), EPS);
    }

    @Test
    void roundFinishedWinsOverInflatedMetaDuration() {
        // meta battleDuration 300s 但 round-finished 在 battle-relative 180s：取真实结束时刻
        final Battle battle = metaOnlyBattle(300.0);
        final ReplayReconstruction recon =
                TimelineTestFixtures.recon(300.0, eventsWithRoundFinished(180.0));

        assertEquals(180.0, BattleTimelineBuilder.resolveDurationSec(battle, recon, START), EPS);
    }

    @Test
    void roundFinishedWinsWithoutAnyDurationSource() {
        final Battle battle = metaOnlyBattle(null);
        final ReplayReconstruction recon =
                TimelineTestFixtures.recon(0.0, eventsWithRoundFinished(95.5));

        assertEquals(95.5, BattleTimelineBuilder.resolveDurationSec(battle, recon, START), EPS);
    }

    @Test
    void roundFinishedAtOrBeforeBattleStartIsIgnoredAndMetaFallbackUsed() {
        final Battle battle = metaOnlyBattle(240.0);
        final ReplayReconstruction recon =
                TimelineTestFixtures.recon(240.0, eventsWithRoundFinished(-5.0));

        assertEquals(240.0, BattleTimelineBuilder.resolveDurationSec(battle, recon, START), EPS);
    }

    @Test
    void metaFallbackUsedWhenNoRoundFinishedAndCappedAt420() {
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        assertEquals(240.0, BattleTimelineBuilder.resolveDurationSec(
                metaOnlyBattle(240.0), TimelineTestFixtures.recon(240.0, events), START), EPS);
        assertEquals(420.0, BattleTimelineBuilder.resolveDurationSec(
                metaOnlyBattle(600.0), TimelineTestFixtures.recon(600.0, events), START), EPS);
    }

    @Test
    void lastEventTimeIsFinalFallback() {
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.position(TimelineTestFixtures.RECORDER_EID, 45, 12f, 12f, 0f));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(0.0, events);

        assertEquals(45.0, BattleTimelineBuilder.resolveDurationSec(metaOnlyBattle(null), recon, START), EPS);
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
        // second 0..180 = 181 帧，不再拖到 meta 的 300s
        assertEquals(181, timeline.frames().size());
    }
}
