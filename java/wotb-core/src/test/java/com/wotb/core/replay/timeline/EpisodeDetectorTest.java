package com.wotb.core.replay.timeline;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.EntityRemovedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.SupremacyPointsChangedEvent;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

class EpisodeDetectorTest {

    @Test
    void episodesCoverWholeBattleWithoutHolesOrOverlaps() {
        final Battle battle = TimelineTestFixtures.battle(120.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.damage(TimelineTestFixtures.RECORDER_EID,
                TimelineTestFixtures.ENEMY_EID, 5, 400));
        events.add(TimelineTestFixtures.health(TimelineTestFixtures.ENEMY_EID, 30, 0, false));
        events.add(TimelineTestFixtures.position(TimelineTestFixtures.ENEMY2_EID, 60, -30f, -30f, 0f));
        events.add(TimelineTestFixtures.health(TimelineTestFixtures.ENEMY2_EID, 95, 500, true));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(120.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();
        assertNotNull(timeline);

        final List<TacticalEpisode> episodes = EpisodeDetector.detect(timeline);
        assertFalse(episodes.isEmpty());

        assertEquals(0.0, episodes.get(0).startSec(), 1e-9);
        assertEquals(120.0, episodes.get(episodes.size() - 1).endSec(), 1e-9);

        for (int i = 1; i < episodes.size(); i++) {
            final TacticalEpisode prev = episodes.get(i - 1);
            final TacticalEpisode cur = episodes.get(i);
            assertTrue(cur.startSec() >= prev.endSec() - 1e-9,
                    "episode " + i + " starts before previous ends");
        }

        for (final TacticalEpisode ep : episodes) {
            assertTrue(ep.durationSec() >= EpisodeDetector.MIN_EPISODE_SEC - 1e-9
                            || episodes.size() == 1,
                    "episode too short: " + ep.durationSec());
        }
    }

    @Test
    void deterministicAcrossRuns() {
        final Battle battle = TimelineTestFixtures.battle(120.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.damage(TimelineTestFixtures.RECORDER_EID,
                TimelineTestFixtures.ENEMY_EID, 5, 400));
        events.add(TimelineTestFixtures.health(TimelineTestFixtures.ENEMY_EID, 30, 0, false));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(120.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        final List<TacticalEpisode> a = EpisodeDetector.detect(timeline);
        final List<TacticalEpisode> b = EpisodeDetector.detect(timeline);
        assertEquals(a.size(), b.size());
        for (int i = 0; i < a.size(); i++) {
            assertEquals(a.get(i).startSec(), b.get(i).startSec(), 1e-9);
            assertEquals(a.get(i).endSec(), b.get(i).endSec(), 1e-9);
            assertEquals(a.get(i).tacticalChanges(), b.get(i).tacticalChanges());
        }
    }

    @Test
    void notFixedThirtySecondChunks() {
        final Battle battle = TimelineTestFixtures.battle(150.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(new EntityRemovedEvent(TimelineTestFixtures.seq++, TimelineTestFixtures.ts(60),
                4, DecodeConfidence.EXACT, TimelineTestFixtures.ENEMY_EID));
        events.add(TimelineTestFixtures.damage(TimelineTestFixtures.RECORDER_EID,
                TimelineTestFixtures.ENEMY_EID, 72, 400));
        events.add(TimelineTestFixtures.health(TimelineTestFixtures.ENEMY_EID, 74, 0, false));
        events.add(TimelineTestFixtures.damage(TimelineTestFixtures.RECORDER_EID,
                TimelineTestFixtures.ENEMY2_EID, 88, 300));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(150.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        final List<TacticalEpisode> episodes = EpisodeDetector.detect(timeline);
        assertTrue(episodes.size() > 1, "must segment into multiple episodes: " + episodes);
        assertTrue(episodes.stream().anyMatch(ep -> Math.abs(ep.startSec() - 70.0) < 1e-9),
                "交火/击毁信号应开启新的 episode（边界 70）：" + episodes);
    }

    @Test
    void episodeDeltasAppearExactlyOnceAcrossAllEpisodes() {
        final Battle battle = TimelineTestFixtures.battle(120.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.damage(TimelineTestFixtures.RECORDER_EID,
                TimelineTestFixtures.ENEMY_EID, 5, 400));
        events.add(TimelineTestFixtures.health(TimelineTestFixtures.ENEMY_EID, 30, 0, false));
        events.add(TimelineTestFixtures.health(TimelineTestFixtures.ENEMY2_EID, 70, 900, true));
        events.add(TimelineTestFixtures.damage(TimelineTestFixtures.RECORDER_EID,
                TimelineTestFixtures.ENEMY2_EID, 90, 300));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(120.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();
        assertNotNull(timeline);

        final int totalDeltas = timeline.frames().stream()
                .mapToInt(frame -> frame.deltas() == null ? 0 : frame.deltas().size())
                .sum();
        final int episodeDeltas = EpisodeDetector.detect(timeline).stream()
                .mapToInt(ep -> ep.deltas().size())
                .sum();
        assertEquals(totalDeltas, episodeDeltas,
                "Episode deltas 必须恰好出现一次（无重复/无丢失）");
    }

    @Test
    void openingQuietGapSplitsBeforeFirstContact() {
        final Battle battle = TimelineTestFixtures.battle(120.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.damage(TimelineTestFixtures.RECORDER_EID,
                TimelineTestFixtures.ENEMY_EID, 25, 400));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(120.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        final List<TacticalEpisode> episodes = EpisodeDetector.detect(timeline);
        assertTrue(!episodes.isEmpty());
        assertTrue(episodes.size() > 1,
                "开局 25s 安静期应产生至少一个切分，实际 " + episodes.size()
                        + " 个 episode: " + episodes);
        assertTrue(episodes.getFirst().endSec() <= 25.0 + 1e-9 + EpisodeDetector.MIN_EPISODE_SEC,
                "首段应覆盖安静期，endSec=" + episodes.getFirst().endSec());
    }

    @Test
    void episodeContainsBothSidesWorldAndTacticalChanges() {
        final Battle battle = TimelineTestFixtures.battle(90.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.damage(TimelineTestFixtures.RECORDER_EID,
                TimelineTestFixtures.ENEMY_EID, 10, 400));
        events.add(TimelineTestFixtures.health(TimelineTestFixtures.ENEMY_EID, 40, 0, false));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(90.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        final List<TacticalEpisode> episodes = EpisodeDetector.detect(timeline);
        assertFalse(episodes.isEmpty());
        for (final TacticalEpisode ep : episodes) {
            assertNotNull(ep.before());
            assertNotNull(ep.after());
            assertTrue(ep.before().friendlyTotal() >= 0);
            assertTrue(ep.before().enemyTotal() >= 0);
        }
    }

    @Test
    void boundaryEpisodeBeforeExcludesSameSecondDestroyEffects() {
        final Battle battle = TimelineTestFixtures.battle(120.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(TimelineTestFixtures.health(TimelineTestFixtures.RECORDER_EID, 15, 1900, true));
        events.add(TimelineTestFixtures.health(TimelineTestFixtures.RECORDER_EID, 25, 1800, true));
        events.add(TimelineTestFixtures.health(TimelineTestFixtures.ENEMY_EID, 30, 0, false));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(120.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();
        assertNotNull(timeline);

        final List<TacticalEpisode> episodes = EpisodeDetector.detect(timeline);
        final TacticalEpisode boundary = episodes.stream()
                .filter(ep -> Math.abs(ep.startSec() - 30.0) < 1e-9)
                .findFirst()
                .orElseThrow(() -> new AssertionError("no episode starts at 30: " + episodes));

        assertEquals(2, boundary.before().enemyAlive(),
                "BEFORE must exclude the same-second destroy effect: " + boundary.before());
        final long destroyedInEpisode = boundary.deltas().stream()
                .filter(d -> d.kind() == DeltaKind.DESTROYED)
                .count();
        assertEquals(1, destroyedInEpisode, "episode EVENTS must contain the destroy exactly once");
        assertEquals(1, boundary.after().enemyAlive(),
                "AFTER must include the destroy effect: " + boundary.after());

        final long totalDestroyed = episodes.stream()
                .flatMap(ep -> ep.deltas().stream())
                .filter(d -> d.kind() == DeltaKind.DESTROYED)
                .count();
        assertEquals(1, totalDestroyed,
                "canonical DESTROYED delta must appear exactly once across all episodes");
    }

    @Test
    void boundaryEpisodeBeforeExcludesSameSecondPointsChange() {
        final Battle battle = TimelineTestFixtures.battle(120.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        events.add(new EntityRemovedEvent(TimelineTestFixtures.seq++, TimelineTestFixtures.ts(10),
                4, DecodeConfidence.EXACT, TimelineTestFixtures.ENEMY_EID));
        events.add(new SupremacyPointsChangedEvent(TimelineTestFixtures.seq++,
                TimelineTestFixtures.ts(0), 8, DecodeConfidence.EXACT, 1, 0));
        events.add(TimelineTestFixtures.health(TimelineTestFixtures.ENEMY_EID, 12, 1400, true));
        events.add(new SupremacyPointsChangedEvent(TimelineTestFixtures.seq++,
                TimelineTestFixtures.ts(20), 8, DecodeConfidence.EXACT, 1, 100));
        events.add(TimelineTestFixtures.health(TimelineTestFixtures.ENEMY_EID, 20, 1300, true));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(120.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();
        assertNotNull(timeline);

        final List<TacticalEpisode> episodes = EpisodeDetector.detect(timeline);
        final TacticalEpisode boundary = episodes.stream()
                .filter(ep -> Math.abs(ep.startSec() - 20.0) < 1e-9)
                .findFirst()
                .orElseThrow(() -> new AssertionError("no episode starts at 20: " + episodes));

        assertEquals(Integer.valueOf(0), boundary.before().friendlyPoints(),
                "BEFORE must not include the same-second points change: " + boundary.before());
        final long pointsChanges = boundary.deltas().stream()
                .filter(d -> d.kind() == DeltaKind.POINTS_CHANGE)
                .count();
        assertEquals(1, pointsChanges, "episode EVENTS must contain the points change exactly once");
        assertEquals(Integer.valueOf(100), boundary.after().friendlyPoints(),
                "AFTER must include the points change: " + boundary.after());

        final long totalPointsChanges = episodes.stream()
                .flatMap(ep -> ep.deltas().stream())
                .filter(d -> d.kind() == DeltaKind.POINTS_CHANGE)
                .count();
        assertEquals(1, totalPointsChanges,
                "canonical POINTS_CHANGE delta must appear exactly once across all episodes");
    }
}
