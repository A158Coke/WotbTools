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
import java.util.List;
import java.util.Map;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertEquals;
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

    @Test
    void hpChangesRenderCorrectSideLabels() {
        // P0 review：己方 HP 变化不得被渲染成“敌方 HP”；
        // recorder → 「你」，friendly 队友 → 「队友」，enemy → 「敌方」（side 来自 delta 属性）。
        final com.wotb.core.model.PlayerResult rec = new com.wotb.core.model.PlayerResult();
        rec.accountId = 1001;
        rec.team = 1;
        rec.tankId = 4481;
        rec.tankName = "Kranvagn";
        rec.nickname = "rec1";
        rec.survived = true;
        final com.wotb.core.model.PlayerResult mate = new com.wotb.core.model.PlayerResult();
        mate.accountId = 1002;
        mate.team = 1;
        mate.tankId = 4481;
        mate.tankName = "Kranvagn";
        mate.nickname = "mate1";
        mate.survived = true;
        final com.wotb.core.model.PlayerResult enemy = new com.wotb.core.model.PlayerResult();
        enemy.accountId = 2001;
        enemy.team = 2;
        enemy.tankId = 14609;
        enemy.tankName = "Leopard 1";
        enemy.nickname = "enemy1";
        enemy.survived = true;
        final com.wotb.core.model.Battle b = new com.wotb.core.model.Battle();
        b.mapName = "middleburg";
        b.arenaBonusType = 1;
        b.durationS = 40.0;
        b.recorder = "rec1";
        b.players = List.of(rec, mate, enemy);

        final java.util.List<com.wotb.core.replay.event.ReplayEvent> events = new java.util.ArrayList<>();
        events.add(new com.wotb.core.replay.event.ParticipantMappingEvent(0,
                new com.wotb.core.replay.event.ReplayTimestamp(1000f, null), 8,
                com.wotb.core.replay.event.DecodeConfidence.EXACT, 1, 1001));
        events.add(new com.wotb.core.replay.event.ParticipantMappingEvent(1,
                new com.wotb.core.replay.event.ReplayTimestamp(1000f, null), 8,
                com.wotb.core.replay.event.DecodeConfidence.EXACT, 2, 1002));
        events.add(new com.wotb.core.replay.event.ParticipantMappingEvent(2,
                new com.wotb.core.replay.event.ReplayTimestamp(1000f, null), 8,
                com.wotb.core.replay.event.DecodeConfidence.EXACT, 3, 2001));
        for (final int eid : new int[]{1, 2, 3}) {
            events.add(new com.wotb.core.replay.event.PositionChangedEvent(10 + eid,
                    new com.wotb.core.replay.event.ReplayTimestamp(1000f, null), 10,
                    com.wotb.core.replay.event.DecodeConfidence.EXACT, eid, 0, 0,
                    eid * 10f, 0f, eid * 10f, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0));
        }
        // 位置流持续到 t=14（HP 变化前一帧仍 active → HP_CHANGE 而非 HP_GAP_DELTA）
        for (final int eid : new int[]{1, 2, 3}) {
            events.add(new com.wotb.core.replay.event.PositionChangedEvent(30 + eid,
                    new com.wotb.core.replay.event.ReplayTimestamp(1014f, null), 10,
                    com.wotb.core.replay.event.DecodeConfidence.EXACT, eid, 0, 0,
                    eid * 10f + 1f, 0f, eid * 10f + 1f, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0));
        }
        // HP：t=5 全满，t=15 各自掉血（产生 HP_CHANGE delta）
        events.add(new com.wotb.core.replay.event.HealthChangedEvent(20,
                new com.wotb.core.replay.event.ReplayTimestamp(1005f, null), 7,
                com.wotb.core.replay.event.DecodeConfidence.EXACT, 1, 2000, null, true));
        events.add(new com.wotb.core.replay.event.HealthChangedEvent(21,
                new com.wotb.core.replay.event.ReplayTimestamp(1005f, null), 7,
                com.wotb.core.replay.event.DecodeConfidence.EXACT, 2, 1800, null, true));
        events.add(new com.wotb.core.replay.event.HealthChangedEvent(22,
                new com.wotb.core.replay.event.ReplayTimestamp(1005f, null), 7,
                com.wotb.core.replay.event.DecodeConfidence.EXACT, 3, 1600, null, true));
        events.add(new com.wotb.core.replay.event.HealthChangedEvent(23,
                new com.wotb.core.replay.event.ReplayTimestamp(1015f, null), 7,
                com.wotb.core.replay.event.DecodeConfidence.EXACT, 1, 1500, null, true));
        events.add(new com.wotb.core.replay.event.HealthChangedEvent(24,
                new com.wotb.core.replay.event.ReplayTimestamp(1015f, null), 7,
                com.wotb.core.replay.event.DecodeConfidence.EXACT, 2, 1200, null, true));
        events.add(new com.wotb.core.replay.event.HealthChangedEvent(25,
                new com.wotb.core.replay.event.ReplayTimestamp(1015f, null), 7,
                com.wotb.core.replay.event.DecodeConfidence.EXACT, 3, 1000, null, true));
        final ReplayReconstruction recon = new ReplayReconstruction(
                new com.wotb.core.replay.reconstruction.ReplayMetadata(
                        "arena", "middleburg", "1", "1", 1, "rec1", "", 40.0, 0L),
                new com.wotb.core.replay.stream.ReplayStreamHeader(
                        0x12345678L, new byte[8], "h", "v", 15),
                40f, 1000f, List.of(), events, List.of(),
                com.wotb.core.replay.reconstruction.BattleStateSnapshot.empty(),
                new com.wotb.core.replay.reconstruction.ReplayCoverage(
                        true, 1, 1, 0, 0, 0, 1.0, Map.of()),
                new com.wotb.core.replay.stream.ReplayStreamDiagnostics(
                        0, 0, 0, 0, 0, 0, 0, 0, 0f, 0f, 0, Map.of(),
                        true, 1000f, true));

        final BattleTimelineResult tl = BattleTimelineBuilder.build(
                b, recon, TimelinePerspective.personal(1001L, 1));
        assertTrue(tl.usable(), "side-label fixture 必须能构建 timeline: " + tl.validation().errors());
        final String section = PersonalAiContextCompiler.renderTimelineSection(tl.timeline(), 1001L);
        assertTrue(section.matches("(?s).*你 .+ HP 2000→1500.*"),
                "recorder 掉血应渲染为「你 HP」，实际:\n" + section);
        assertTrue(section.matches("(?s).*队友 .+ HP 1800→1200.*"),
                "friendly 队友掉血应渲染为「队友 HP」，实际:\n" + section);
        assertTrue(section.matches("(?s).*敌方 .+ HP 1600→1000.*"),
                "enemy 掉血应渲染为「敌方 HP」，实际:\n" + section);
    }

    @Test
    void episodeSelectionKeepsHeadAndTailForLongBattles() {
        // P1 review：超长战斗保留首尾 Episode（残局不丢），中间折叠
        final java.util.List<Integer> selected = PersonalAiContextCompiler.selectedEpisodeIndices(20, 14);
        assertEquals(14, selected.size());
        assertEquals(Integer.valueOf(0), selected.getFirst(), "必须保留首个 Episode");
        assertEquals(Integer.valueOf(19), selected.getLast(), "必须保留最后（残局）Episode");
        assertTrue(new java.util.HashSet<>(selected).size() == selected.size(), "选区不得重复");
        // 升序
        for (int i = 1; i < selected.size(); i++) {
            assertTrue(selected.get(i) > selected.get(i - 1));
        }
        // 不超限时全选
        assertEquals(10, PersonalAiContextCompiler.selectedEpisodeIndices(10, 14).size());
    }
}
