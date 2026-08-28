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
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertFalse;
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
    void realRandomBattleWithoutBattleStartAuthorityFailsClosed() throws Exception {
        final byte[] bytes = Files.readAllBytes(fixture());
        final Battle battle = ReplayParser.parse(bytes);
        final ReplayReconstruction recon = new ReplayReconstructionService().reconstruct(bytes);
        final PlayerResult recorder = battle.recorderResult();
        assertNotNull(recorder, "真实夹具必须能解析录像者");
        // PR162/P0-3：随机战夹具无 ArenaPeriod BATTLE / RoundFinished 权威（probe 证实 arenaPeriod=0,
        // roundFinished=0），battle-start 必须 fail-closed 为 null，绝不退化为「max clock - settlement
        // duration」伪造。
        assertNull(recon.battleStartRawClockSec(),
                "无权威 battle-start 时必须 fail-closed（不得用 max clock - duration 伪造）");

        final BattleTimelineResult result = BattleTimelineBuilder.build(
                battle, recon, TimelinePerspective.personal(
                        recorder.accountId > 0 ? recorder.accountId : null, recorder.team));
        assertFalse(result.usable(),
                "无 battle-start 权威时必须 fail-closed（不伪造 clock）: " + result.validation().errors());
        assertTrue(result.validation().errors().contains(TimelineError.TIMELINE_CLOCK_UNRESOLVED),
                "失败原因必须是 TIMELINE_CLOCK_UNRESOLVED: " + result.validation().errors());
    }
}
