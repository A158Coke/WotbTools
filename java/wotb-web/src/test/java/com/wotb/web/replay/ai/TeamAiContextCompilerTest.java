package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayMetadata;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;
import com.wotb.core.replay.stream.ReplayStreamHeader;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.BattleTimelineResult;
import com.wotb.core.replay.timeline.TimelinePerspective;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * TeamAiContextCompiler：团队视角 Episode 化上下文必须双方对称（我方/敌方），不以录像者为中心。
 */
class TeamAiContextCompilerTest {

    private static Battle battle() {
        final List<PlayerResult> players = new ArrayList<>();
        for (final long id : new long[]{1001, 1002, 2001, 2002}) {
            final PlayerResult p = new PlayerResult();
            p.accountId = id;
            p.team = id < 2000 ? 1 : 2;
            p.tankId = 4481;
            p.tankName = "Kranvagn";
            p.nickname = "p" + id;
            p.survived = true;
            players.add(p);
        }
        final Battle b = new Battle();
        b.mapName = "middleburg";
        b.arenaBonusType = 2;
        b.durationS = 90.0;
        b.players = players;
        return b;
    }

    private static ReplayReconstruction recon() {
        final ReplayMetadata meta = new ReplayMetadata(
                "arena", "middleburg", "1", "1", 2, "rec1", "", 90.0, 0L);
        final ReplayStreamHeader header = new ReplayStreamHeader(0x12345678L, new byte[8], "h", "v", 15);
        final ReplayCoverage coverage = new ReplayCoverage(true, 6, 6, 0, 0, 0, 1.0, Map.of());
        final ReplayStreamDiagnostics diag = new ReplayStreamDiagnostics(
                0, 0, 0, 0, 0, 0, 0, 0, 0f, 0f, 0, Map.of(), true, 1000f, true);
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(0, new ReplayTimestamp(1000f, 0f), 8,
                DecodeConfidence.EXACT, 1, 1001));
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(1000f, 0f), 8,
                DecodeConfidence.EXACT, 2, 1002));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(1000f, 0f), 8,
                DecodeConfidence.EXACT, 3, 2001));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(1000f, 0f), 8,
                DecodeConfidence.EXACT, 4, 2002));
        events.add(new PositionChangedEvent(4, new ReplayTimestamp(1000f, 0f), 10,
                DecodeConfidence.EXACT, 1, 0, 0, 0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0));
        events.add(new PositionChangedEvent(5, new ReplayTimestamp(1000f, 0f), 10,
                DecodeConfidence.EXACT, 2, 0, 0, 5f, 0f, 5f, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0));
        events.add(new PositionChangedEvent(6, new ReplayTimestamp(1000f, 0f), 10,
                DecodeConfidence.EXACT, 3, 0, 0, -20f, 0f, -20f, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0));
        events.add(new PositionChangedEvent(7, new ReplayTimestamp(1000f, 0f), 10,
                DecodeConfidence.EXACT, 4, 0, 0, -25f, 0f, -25f, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0));
        events.add(new HealthChangedEvent(8, new ReplayTimestamp(1000f, 0f), 7,
                DecodeConfidence.EXACT, 1, 1800, null, true));
        events.add(new HealthChangedEvent(9, new ReplayTimestamp(1000f, 0f), 7,
                DecodeConfidence.EXACT, 3, 1600, null, true));
        // 首次接敌 12s + 敌方掉血
        events.add(new DamageEvent(10, new ReplayTimestamp(1012f, 12f), 8,
                DecodeConfidence.EXACT, 1, 3, null, null, 420, false));
        events.add(new HealthChangedEvent(11, new ReplayTimestamp(1013f, 13f), 7,
                DecodeConfidence.EXACT, 3, 1180, null, true));
        final BattleStateCheckpoint cp = new BattleStateCheckpoint(1000f, 0,
                BattleStateSnapshot.empty());
        return new ReplayReconstruction(meta, header, 90f, 1000f, List.of(),
                events, List.of(cp), BattleStateSnapshot.empty(), coverage, diag);
    }

    @Test
    void teamTimelineSectionIsSymmetricAndNotRecorderCentric() {
        final Battle battle = battle();
        final ReplayReconstruction recon = recon();
        final BattleTimelineResult tl = BattleTimelineBuilder.build(
                battle, recon, TimelinePerspective.team(1));
        assertTrue(tl.usable(), "团队 fixture 必须能构建 timeline: " + tl.validation().errors());
        final BattleTimeline timeline = tl.timeline();

        final String section = TeamAiContextCompiler.renderTimelineSection(timeline, 1);
        assertTrue(section.contains("EPISODE 1"), "必须渲染团队章节");
        assertTrue(section.contains("我方_alive="), "必须包含我方存活（friendly deployment）");
        assertTrue(section.contains("敌方_alive="), "必须包含敌方存活（对称）");
        assertTrue(section.contains("敌方_unknown="), "必须包含敌方未知数");
        assertTrue(section.contains("首次接敌"), "必须表达首次接敌");
        // 不以录像者为中心：不得出现 YOU 个人标注
        assertTrue(!section.contains("YOU hp="), "团队视角不得以录像者为中心");
        // 确定性
        assertTrue(TeamAiContextCompiler.renderTimelineSection(timeline, 1).equals(section));
    }

    @Test
    void renderTimelineBlockInjectsValidatedTimelineSection() {
        // PR #102 ：PromptBuilder 不再内部 build —— 由 orchestration 层验证后
        // 传入 timeline，renderTimelineBlock 只做确定性渲染。
        final BattleTimeline timeline = BattleTimelineBuilder.build(
                battle(), recon(), TimelinePerspective.team(1)).timeline();
        final String block = TeamAiPromptBuilder.renderTimelineBlock(timeline, 1);
        assertTrue(block.contains("TACTICAL TIMELINE"), "团队 prompt 必须注入 timeline 段");
        assertTrue(block.contains("EPISODE 1"));
        // 确定性
        assertTrue(block.equals(TeamAiPromptBuilder.renderTimelineBlock(timeline, 1)));
        // null（兼容/测试入口未提供 validated timeline）→ 不渲染任何段
        assertTrue(TeamAiPromptBuilder.renderTimelineBlock(null, 1).isEmpty());
    }
}
