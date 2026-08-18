package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.parse.ReplayParser;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.ReplayReconstructionService;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.BattleTimelineResult;
import com.wotb.core.replay.timeline.TimelinePerspective;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * PersonalAiContextCompiler：真实随机战夹具 → canonical timeline → Episode 化 compact 上下文。
 */
class PersonalAiContextCompilerTest {

    private static Path fixture() throws Exception {
        final Path dir = Path.of(System.getProperty("user.dir"), "..", "..", "common", "fixtures", "replays")
                .normalize();
        try (Stream<Path> s = Files.list(dir)) {
            return s.filter(p -> p.getFileName().toString().contains("random-battle-example"))
                    .findFirst().orElseThrow();
        }
    }

    @Test
    void realFixtureRendersEpisodeTimelineSection() throws Exception {
        final byte[] bytes = Files.readAllBytes(fixture());
        final Battle battle = ReplayParser.parse(bytes);
        final ReplayReconstruction recon = new ReplayReconstructionService().reconstruct(bytes);
        final PlayerResult recorder = battle.recorderResult();
        assertNotNull(recorder);

        final BattleTimelineResult result = BattleTimelineBuilder.build(
                battle, recon, TimelinePerspective.personal(
                        recorder.accountId > 0 ? recorder.accountId : null, recorder.team));
        assertTrue(result.usable(), "真实回放必须能构建 timeline: " + result.validation().errors());
        final BattleTimeline timeline = result.timeline();

        final String section = PersonalAiContextCompiler.renderTimelineSection(
                timeline, recorder.accountId > 0 ? recorder.accountId : null);
        assertTrue(section.contains("EPISODE 1"), "必须渲染 EPISODE 章节");
        assertTrue(section.contains("BEFORE friendly_alive="), "必须包含双方世界状态（BEFORE）");
        assertTrue(section.contains("AFTER friendly_alive="), "必须包含双方世界状态（AFTER）");
        assertTrue(section.contains("enemy_unknown="), "必须显式表达未知敌人数（docs/current-plan.md §9.2）");
        assertTrue(section.contains("战斗总时长"), "必须给出战斗总时长");
        // 时间格式必须为 X分XX秒（AI 复盘约定），不得出现裸秒数时间轴
        assertTrue(section.contains("分"), "时间必须使用分秒格式");
        // 确定性
        final String again = PersonalAiContextCompiler.renderTimelineSection(timeline,
                recorder.accountId > 0 ? recorder.accountId : null);
        assertTrue(again.equals(section), "编译结果必须 deterministic");
    }

    @Test
    void nullTimelineReturnsEmpty() {
        assertTrue(PersonalAiContextCompiler.renderTimelineSection(null, 1L).isEmpty());
    }
}
