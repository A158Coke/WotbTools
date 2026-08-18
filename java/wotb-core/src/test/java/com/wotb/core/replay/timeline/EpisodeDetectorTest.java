package com.wotb.core.replay.timeline;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * EpisodeDetector（docs/current-plan.md §23/§24）：覆盖整场、连续、无重叠、deterministic、
 * 不机械固定 30 秒切块；Episode 与 Window 分离。
 */
class EpisodeDetectorTest {

    @Test
    void episodesCoverWholeBattleWithoutHolesOrOverlaps() {
        final Battle battle = TimelineTestFixtures.battle(120.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        // 关键事件：5s 首次接敌、30s 敌方阵亡、60s 点数变化、95s 大 HP swing
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

        // 覆盖整场：[0, maxSecond]
        assertEquals(0.0, episodes.get(0).startSec(), 1e-9);
        assertEquals(120.0, episodes.get(episodes.size() - 1).endSec(), 1e-9);

        // 连续无重叠
        for (int i = 1; i < episodes.size(); i++) {
            final TacticalEpisode prev = episodes.get(i - 1);
            final TacticalEpisode cur = episodes.get(i);
            assertTrue(cur.startSec() >= prev.endSec() - 1e-9,
                    "episode " + i + " starts before previous ends");
        }

        // 时长约束：硬最小 8s（战斗 120s 足够长）
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
        // 所有战术信号集中在 70-90s：Episode 边界应跟随信号而不是 30s 网格
        events.add(TimelineTestFixtures.damage(TimelineTestFixtures.RECORDER_EID,
                TimelineTestFixtures.ENEMY_EID, 72, 400));
        events.add(TimelineTestFixtures.health(TimelineTestFixtures.ENEMY_EID, 74, 0, false));
        events.add(TimelineTestFixtures.damage(TimelineTestFixtures.RECORDER_EID,
                TimelineTestFixtures.ENEMY2_EID, 88, 300));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(150.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        final List<TacticalEpisode> episodes = EpisodeDetector.detect(timeline);
        // 若有多个 episode，其边界必须偏离纯 30s 网格（0/30/60/90/120/150）
        if (episodes.size() > 1) {
            for (int i = 1; i < episodes.size(); i++) {
                final double boundary = episodes.get(i).startSec();
                final boolean onGrid = Math.abs(boundary % 30.0) < 1.0;
                assertFalse(onGrid, "episode boundary " + boundary + " lies on fixed 30s grid");
            }
        }
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
            // before/after 必须包含双方存活人数（FRIENDLY + ENEMY_KNOWLEDGE）
            assertTrue(ep.before().friendlyTotal() >= 0);
            assertTrue(ep.before().enemyTotal() >= 0);
        }
    }
}
