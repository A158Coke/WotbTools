package com.wotb.core.replay.timeline;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayReconstructionService;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Structural regression（docs/architecture/battle-timeline.md §52.1）：真实夹具上的 Timeline 结构不变量——
 * deterministic、事件无丢失/无重复、Episode 覆盖完整。
 */
class BattleTimelineStructuralEvalTest {

    private static Path fixture() throws Exception {
        final Path dir = Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures", "replays")
                .normalize();
        try (Stream<Path> s = Files.list(dir)) {
            return s.filter(p -> p.getFileName().toString().contains("random-battle-example"))
                    .findFirst().orElseThrow();
        }
    }

    @Test
    void deterministicRebuildProducesIdenticalFrames() throws Exception {
        final byte[] bytes = Files.readAllBytes(fixture());
        final Battle battle = ReplayParser.parse(bytes);
        final ReplayReconstruction recon = new ReplayReconstructionService().reconstruct(bytes);
        final PlayerResult recorder = battle.recorderResult();
        final TimelinePerspective perspective = TimelinePerspective.personal(
                recorder.accountId > 0 ? recorder.accountId : null, recorder.team);
        // P0-3: 现场夹具无 battle-start 权威（ArenaPeriod/RoundFinished）→ 必须 fail-closed，不得伪造。
        if (recon.battleStartRawClockSec() == null) {
            final BattleTimelineResult r = BattleTimelineBuilder.build(battle, recon, perspective);
            assertFalse(r.usable());
            assertTrue(r.validation().errors().contains(TimelineError.TIMELINE_CLOCK_UNRESOLVED));
            return;
        }

        final BattleTimeline a = BattleTimelineBuilder.build(battle, recon, perspective).timeline();
        final BattleTimeline b = BattleTimelineBuilder.build(battle, recon, perspective).timeline();
        assertNotNull(a);
        assertEquals(a.frames().size(), b.frames().size());
        for (int i = 0; i < a.frames().size(); i++) {
            assertEquals(a.frames().get(i).world(), b.frames().get(i).world(),
                    "frame " + i + " world 必须 deterministic");
            assertEquals(a.frames().get(i).events().size(), b.frames().get(i).events().size(),
                    "frame " + i + " events 必须 deterministic");
        }
    }

    @Test
    void eventsAreLosslessAndNonDuplicatedAcrossFrames() throws Exception {
        final byte[] bytes = Files.readAllBytes(fixture());
        final Battle battle = ReplayParser.parse(bytes);
        final ReplayReconstruction recon = new ReplayReconstructionService().reconstruct(bytes);
        final PlayerResult recorder = battle.recorderResult();
        if (recon.battleStartRawClockSec() == null) {
            final BattleTimelineResult r = BattleTimelineBuilder.build(
                    battle, recon, TimelinePerspective.personal(
                            recorder.accountId > 0 ? recorder.accountId : null, recorder.team));
            assertFalse(r.usable());
            assertTrue(r.validation().errors().contains(TimelineError.TIMELINE_CLOCK_UNRESOLVED));
            return;
        }
        final BattleTimeline timeline = BattleTimelineBuilder.build(
                battle, recon, TimelinePerspective.personal(
                        recorder.accountId > 0 ? recorder.accountId : null, recorder.team)).timeline();
        assertNotNull(timeline);

        // 帧内事件分区必须互斥（无重复）；battle-relative 落在 [0, duration] 的事件必须恰好出现一次（无丢失）。
        // 开战前（负时间）与战斗结束后的尾部事件不属于任何帧窗口，不计入 lossless。
        final Set<Integer> seen = new HashSet<>();
        int total = 0;
        int inRange = 0;
        for (final BattleFrame frame : timeline.frames()) {
            for (final com.wotb.core.replay.event.ReplayEvent e : frame.events()) {
                assertTrue(seen.add(e.sequence()),
                        "事件重复: seq=" + e.sequence() + " frame=" + frame.second());
                total++;
            }
        }
        // 帧窗口实际覆盖 (-1, maxSecond]（frame 0 含开战前 1s 内的负时间事件；末帧含尾事件）
        final double lastFrameSec = timeline.frames().getLast().stateAtSec();
        for (final com.wotb.core.replay.event.ReplayEvent e : timeline.events()) {
            final double t = TimelineClock.battleClockOf(e, timeline.battleStartRawClockSec());
            if (t > -1 && t <= lastFrameSec) {
                inRange++;
            }
        }
        assertEquals(inRange, total,
                "(-1, maxSecond] 内事件必须恰好出现一次（无丢失/无重复）");
    }

    @Test
    void episodesCoverWholeBattleDeterministically() throws Exception {
        final byte[] bytes = Files.readAllBytes(fixture());
        final Battle battle = ReplayParser.parse(bytes);
        final ReplayReconstruction recon = new ReplayReconstructionService().reconstruct(bytes);
        final PlayerResult recorder = battle.recorderResult();
        if (recon.battleStartRawClockSec() == null) {
            final BattleTimelineResult r = BattleTimelineBuilder.build(
                    battle, recon, TimelinePerspective.personal(
                            recorder.accountId > 0 ? recorder.accountId : null, recorder.team));
            assertFalse(r.usable());
            assertTrue(r.validation().errors().contains(TimelineError.TIMELINE_CLOCK_UNRESOLVED));
            return;
        }
        final BattleTimeline timeline = BattleTimelineBuilder.build(
                battle, recon, TimelinePerspective.personal(
                        recorder.accountId > 0 ? recorder.accountId : null, recorder.team)).timeline();

        final var episodes = EpisodeDetector.detect(timeline);
        assertTrue(!episodes.isEmpty(), "真实回放必须产出 Episode");
        assertEquals(0.0, episodes.getFirst().startSec(), 1e-9, "首个 Episode 必须从 0 开始");
        // 末个 Episode 必须覆盖战斗结束（到最后一帧 stateAt；帧粒度取 ceil）
        final double lastFrameSec = timeline.frames().getLast().stateAtSec();
        assertEquals(lastFrameSec, episodes.getLast().endSec(), 1e-6,
                "末个 Episode 必须覆盖到最后一帧");
        assertTrue(episodes.getLast().endSec() >= timeline.durationSec() - 1e-6,
                "末个 Episode 必须覆盖战斗结束");
        for (int i = 1; i < episodes.size(); i++) {
            assertTrue(episodes.get(i).startSec() >= episodes.get(i - 1).endSec() - 1e-9,
                    "Episode 不得重叠/留洞");
        }
        // 确定性
        assertEquals(EpisodeDetector.detect(timeline).size(), episodes.size());
    }
}
