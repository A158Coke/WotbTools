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
    void realRandomBattleArenaPeriodBattleAnchorIsDecodedAndTimelineUsable() throws Exception {
        final byte[] bytes = Files.readAllBytes(fixture());
        final Battle battle = ReplayParser.parse(bytes);
        final ReplayReconstruction recon = new ReplayReconstructionService().reconstruct(bytes);
        final PlayerResult recorder = battle.recorderResult();
        assertNotNull(recorder, "真实夹具必须能解析录像者");
        // PR162/P0-2+：subtype48 wrapper=3 ARENA_PERIOD 的 root field3 实为<b>嵌套消息</b>，其 field1 = period raw。
        // 旧 decoder 只认 Number → 误判「无 battle-start 权威」→ fail-closed；修正后该夹具真实夹具的
        // BATTLE 锚点被解码 → battleStart 非 null（是权威锚点，绝非 max clock - duration 伪造）。
        assertNotNull(recon.battleStartRawClockSec(), "明确 BATTLE 锚点必须被解码，而非 fail-closed 成 null");

        final BattleTimelineResult result = BattleTimelineBuilder.build(
                battle, recon, TimelinePerspective.personal(
                        recorder.accountId > 0 ? recorder.accountId : null, recorder.team));
        assertTrue(result.usable(), "有权威 BATTLE 锚点时 timeline 必须可构建: " + result.validation().errors());
    }
}
