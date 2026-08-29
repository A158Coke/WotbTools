package com.wotb.core.replay.timeline;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.event.DecodeConfidence;
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

/**
 * EpisodeDetector（docs/architecture/battle-timeline.md §23/§24）：覆盖整场、连续、无重叠、deterministic、
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
    void episodeDeltasAppearExactlyOnceAcrossAllEpisodes() {
        // flatten 所有 Episode deltas 后，每个 canonical delta 恰好出现一次
        // （半开区间 [start, end) 契约：边界秒的 delta 不重复）。
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
        // 开局长时间无事件（quiet gap）后首次接敌，应产生切分；
        // lastDeltaSeen 初始值不得使用整场最后一次 delta（未来信息）。
        final Battle battle = TimelineTestFixtures.battle(120.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        // 前 25s 无任何战术事件（仅开局位置/血量）；25s 才首次接敌
        events.add(TimelineTestFixtures.damage(TimelineTestFixtures.RECORDER_EID,
                TimelineTestFixtures.ENEMY_EID, 25, 400));
        final ReplayReconstruction recon = TimelineTestFixtures.recon(120.0, events);
        final BattleTimeline timeline = BattleTimelineBuilder
                .build(battle, recon, TimelineTestFixtures.personalPerspective()).timeline();

        final List<TacticalEpisode> episodes = EpisodeDetector.detect(timeline);
        // 第一个 Episode 必须覆盖开局安静期且结束于首次接敌附近（≤ 25s + MIN 展宽）
        assertTrue(!episodes.isEmpty());
        assertTrue(episodes.size() > 1,
                "开局 25s 安静期应产生至少一个切分，实际 " + episodes.size()
                        + " 个 episode: " + episodes);
        // 首个 episode 结束不晚于 25s + 硬最小展宽（8s）
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
            // before/after 必须包含双方存活人数（FRIENDLY + ENEMY_KNOWLEDGE）
            assertTrue(ep.before().friendlyTotal() >= 0);
            assertTrue(ep.before().enemyTotal() >= 0);
        }
    }

    @Test
    void boundaryEpisodeBeforeExcludesSameSecondDestroyEffects() {
        // Review V3 P0：second=30 敌车阵亡必须成为新 Episode 的起始强事件，
        // BEFORE 表示该秒 delta 发生前的状态（enemyAlive=2）——
        // 不能用 frame(30)（BattleFrame(30) 已消费 ≤30 事件 → 提前显示 enemyAlive=1）。
        // 构造：录像者 HP delta 于 15/25s（score 0）抑制 ENEMY_LOST(6s) 引发的
        // quiet-gap 切分（16/26s），使 30s 阵亡以 length=30 ≥ MIN 成为强信号边界。
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

        // BEFORE：阵亡发生前两辆敌车都存活（不含 second=30 阵亡效果）
        assertEquals(2, boundary.before().enemyAlive(),
                "BEFORE must exclude the same-second destroy effect: " + boundary.before());
        // EVENTS：恰好一次 DESTROYED
        final long destroyedInEpisode = boundary.deltas().stream()
                .filter(d -> d.kind() == DeltaKind.DESTROYED)
                .count();
        assertEquals(1, destroyedInEpisode, "episode EVENTS must contain the destroy exactly once");
        // AFTER：一辆敌车阵亡
        assertEquals(1, boundary.after().enemyAlive(),
                "AFTER must include the destroy effect: " + boundary.after());

        // flatten 全部分集后 DESTROYED 仍恰好出现一次（半开段契约不回归）
        final long totalDestroyed = episodes.stream()
                .flatMap(ep -> ep.deltas().stream())
                .filter(d -> d.kind() == DeltaKind.DESTROYED)
                .count();
        assertEquals(1, totalDestroyed,
                "canonical DESTROYED delta must appear exactly once across all episodes");
    }

    @Test
    void boundaryEpisodeBeforeExcludesSameSecondPointsChange() {
        // Review V3 P0（POINTS_CHANGE 同类）：second=20 点数变化必须成为新 Episode 的
        // 起始事件，BEFORE 不得提前包含该点数变化（friendlyPoints 仍为基线 0）。
        // 构造：敌方 HP delta 于 12s（位置流已 LAST_KNOWN → HP_GAP_DELTA score 2，抑制 quiet-gap 切分 16s），
        // second=20 由 HP_GAP_DELTA(score 2) + POINTS_CHANGE(score 1) = 3 触发强信号边界。
        // （己方 HP 在 PR #103 carry-forward 语义下为直接观测 HP_CHANGE score 0，故用敌方 HP 构造信息空窗。）
        final Battle battle = TimelineTestFixtures.battle(120.0);
        final List<ReplayEvent> events = new ArrayList<>(TimelineTestFixtures.standardEvents());
        // 先有基线点数（t=0，0 分），20s 变化为 100 → frame(20) 触发 POINTS_CHANGE
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

        // BEFORE：点数变化前仍为基线 0（不含 second=20 的变化）
        assertEquals(Integer.valueOf(0), boundary.before().friendlyPoints(),
                "BEFORE must not include the same-second points change: " + boundary.before());
        // EVENTS：恰好一次 POINTS_CHANGE
        final long pointsChanges = boundary.deltas().stream()
                .filter(d -> d.kind() == DeltaKind.POINTS_CHANGE)
                .count();
        assertEquals(1, pointsChanges, "episode EVENTS must contain the points change exactly once");
        // AFTER：点数已更新为 100
        assertEquals(Integer.valueOf(100), boundary.after().friendlyPoints(),
                "AFTER must include the points change: " + boundary.after());

        // flatten 全部分集后 POINTS_CHANGE 仍只出现一次
        final long totalPointsChanges = episodes.stream()
                .flatMap(ep -> ep.deltas().stream())
                .filter(d -> d.kind() == DeltaKind.POINTS_CHANGE)
                .count();
        assertEquals(1, totalPointsChanges,
                "canonical POINTS_CHANGE delta must appear exactly once across all episodes");
    }
}
