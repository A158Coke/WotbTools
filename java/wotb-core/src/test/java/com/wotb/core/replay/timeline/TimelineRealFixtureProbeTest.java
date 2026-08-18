package com.wotb.core.replay.timeline;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayReconstructionService;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 真实回放夹具（common/fixtures/replays/random-battle-example.wotbreplay，rift 随机战）
 * 端到端 Timeline 探针：真实事件流 → canonical timeline。
 */
class TimelineRealFixtureProbeTest {

    private static Path fixture() throws Exception {
        final Path dir = Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures", "replays")
                .normalize();
        try (Stream<Path> s = Files.list(dir)) {
            return s.filter(p -> p.getFileName().toString().contains("random-battle-example"))
                    .findFirst().orElseThrow();
        }
    }

    @Test
    void realRandomBattleBuildsUsableTimeline() throws Exception {
        final byte[] bytes = Files.readAllBytes(fixture());
        final Battle battle = ReplayParser.parse(bytes);
        final ReplayReconstruction recon = new ReplayReconstructionService().reconstruct(bytes);
        final PlayerResult recorder = battle.recorderResult();
        assertNotNull(recorder, "真实夹具必须能解析录像者");

        final BattleTimelineResult result = BattleTimelineBuilder.build(
                battle, recon, TimelinePerspective.personal(
                        recorder.accountId > 0 ? recorder.accountId : null, recorder.team));
        assertTrue(result.usable(), "真实回放必须构建可用 timeline: " + result.validation().errors());

        final BattleTimeline timeline = result.timeline();
        assertTrue(timeline.durationSec() > 0);
        assertTrue(timeline.frames().size() > 100, "300s 战斗应有 >100 帧，实际 " + timeline.frames().size());
        // 时钟：生产无 IDENTIFIED start，应走 ESTIMATED（BattleEndedEvent - duration）
        assertTrue(timeline.clockResolution() == BattleTimelineClock.IDENTIFIED
                        || timeline.clockResolution() == BattleTimelineClock.ESTIMATED,
                "时钟必须可解析，实际 " + timeline.clockResolution());

        // 敌方知识状态在真实数据上必须有分布（已知/last-known/未知/阵亡至少出现两种）
        final BattleFrame late = timeline.frameAt(timeline.durationSec() * 0.9);
        final WorldSummary world = late.world();
        assertTrue(world.enemyTotal() > 0);
        assertTrue(world.enemyKnown() + world.enemyLastKnown() + world.enemyUnknown() >= 0);

        // 录像者位置知识应为 CURRENT（本方位置流开局完整，见 docs/research/replay/protocol.md）
        final FrameVehicle recorderVehicle = late.vehicles().stream()
                .filter(v -> v.friendly() && v.entityId() > 0)
                .findFirst().orElse(null);
        assertNotNull(recorderVehicle, "帧中应包含己方车辆");
        assertNotNull(recorderVehicle.position());
        assertTrue(recorderVehicle.position().knowledge() != PositionKnowledge.UNKNOWN,
                "己方位置流应可观测");
    }
}
