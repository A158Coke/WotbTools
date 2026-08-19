package com.wotb.web.replay.ai;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.EntityCreatedEvent;
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

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Team Review FOCUS WINDOWS 渲染（docs/current-plan.md §5/§13）：每个窗口必须输出
 * BEFORE / EVENTS / AFTER / OBSERVED FACTS / EVIDENCE LIMITATIONS；不 future leak；
 * 稀疏证据不编造战术原因。
 */
class TeamFocusWindowsRenderTest {

    private static final float START_RAW = 1000f;

    private static ReplayTimestamp ts(final double battleSec) {
        return new ReplayTimestamp((float) (START_RAW + battleSec), null);
    }

    private static int seq = 0;

    private static Battle battle(final double durationSec) {
        final List<PlayerResult> players = new ArrayList<>();
        for (long id : new long[]{1001, 1002, 1003, 1004, 2001, 2002, 2003, 2004}) {
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
        b.durationS = durationSec;
        b.players = players;
        return b;
    }

    /**
     * 8 车（4v4）开局 + 连续减员：本方 112/121/132，对方 128；残局 170。
     */
    private static List<ReplayEvent> collapseEvents() {
        seq = 0;
        final List<ReplayEvent> events = new ArrayList<>();
        for (int eid = 1; eid <= 8; eid++) {
            final long account = eid <= 4 ? 1000L + eid : 2000L + (eid - 4);
            events.add(new ParticipantMappingEvent(seq++, ts(0), 8, DecodeConfidence.EXACT, eid, account));
            events.add(new EntityCreatedEvent(seq++, ts(0), 0, DecodeConfidence.EXACT, eid, new byte[0]));
            final float x = eid <= 4 ? eid * 15f : -eid * 15f;
            events.add(new PositionChangedEvent(seq++, ts(0), 10, DecodeConfidence.EXACT,
                    eid, 0, 0, x, 0f, x, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0));
            events.add(new HealthChangedEvent(seq++, ts(0), 7, DecodeConfidence.EXACT,
                    eid, 2000, null, true));
        }
        events.add(new DamageEvent(seq++, ts(50), 8, DecodeConfidence.EXACT, 1, 5, null, null, 400, false));
        events.add(new HealthChangedEvent(seq++, ts(112), 7, DecodeConfidence.EXACT, 1, 0, null, false));
        events.add(new HealthChangedEvent(seq++, ts(121), 7, DecodeConfidence.EXACT, 2, 0, null, false));
        events.add(new HealthChangedEvent(seq++, ts(128), 7, DecodeConfidence.EXACT, 5, 0, null, false));
        events.add(new HealthChangedEvent(seq++, ts(132), 7, DecodeConfidence.EXACT, 3, 0, null, false));
        events.add(new HealthChangedEvent(seq++, ts(170), 7, DecodeConfidence.EXACT, 4, 0, null, false));
        return events;
    }

    private static ReplayReconstruction recon(final double durationSec, final List<ReplayEvent> events) {
        final ReplayMetadata meta = new ReplayMetadata(
                "arena", "middleburg", "1", "1", 2, "rec1", "", durationSec, 0L);
        final ReplayStreamHeader header = new ReplayStreamHeader(0x12345678L, new byte[8], "h", "v", 15);
        final ReplayCoverage coverage = new ReplayCoverage(true, 8, 8, 0, 0, 0, 1.0, Map.of());
        final ReplayStreamDiagnostics diag = new ReplayStreamDiagnostics(
                0, 0, 0, 0, 0, 0, 0, 0, 0f, 0f, 0, Map.of(), true, START_RAW, true);
        final BattleStateCheckpoint cp = new BattleStateCheckpoint(START_RAW, 0, BattleStateSnapshot.empty());
        return new ReplayReconstruction(meta, header, (float) durationSec, START_RAW, List.of(),
                events, List.of(cp), BattleStateSnapshot.empty(), coverage, diag);
    }

    @Test
    void rendersFocusWindowsWithBeforeEventsAfterAndLimitations() {
        final BattleTimelineResult tl = BattleTimelineBuilder.build(
                battle(180.0), recon(180.0, collapseEvents()), TimelinePerspective.team(1));
        assertTrue(tl.usable(), "timeline must be valid: " + tl.validation().errors());
        final BattleTimeline timeline = tl.timeline();

        final String section = TeamAiContextCompiler.renderFocusWindowsSection(timeline, 1);
        assertFalse(section.isBlank(), "必须渲染 FOCUS WINDOWS 段");
        assertTrue(section.contains("TEAM REVIEW FOCUS WINDOWS"), "必须携带段头");
        assertTrue(section.contains("WINDOW 1 time="), "必须渲染 WINDOW 1 时间范围");
        assertTrue(section.contains("BEFORE 我方_alive=4"), "窗口前本方存活 4");
        assertTrue(section.contains("AFTER 我方_alive=1"), "窗口后本方存活 1");
        assertTrue(section.contains("EVENTS"), "必须输出 EVENTS");
        assertTrue(section.contains("OBSERVED FACTS"), "必须输出 OBSERVED FACTS");
        assertTrue(section.contains("本方阵亡 3 辆，对方阵亡 1 辆"), "必须给出连续减员事实");
        assertTrue(section.contains("EVIDENCE LIMITATIONS"), "必须输出 EVIDENCE LIMITATIONS");
        assertTrue(section.contains("当前证据无法证明具体原因"), "必须写明证据边界");
        // 不 future leak：窗口 1 内不得出现 170s 的残局阵亡
        final int window1End = section.indexOf("WINDOW 2");
        final String window1 = window1End < 0 ? section : section.substring(0, window1End);
        assertFalse(window1.contains("2分50秒"), "窗口 1 不得引用未来事件（170s）");
        assertFalse(window1.contains("阵亡 1 辆，对方阵亡 0 辆"), "窗口 1 不得包含残局阵亡");
        // 确定性
        assertTrue(TeamAiContextCompiler.renderFocusWindowsSection(timeline, 1).equals(section));
    }

    @Test
    void sparseEvidenceRendersNoFabricatedWindow() {
        // 只有一次小型交火、无阵亡无 HP swing 无点数 → 不应编造窗口
        final List<ReplayEvent> events = collapseEvents();
        final List<ReplayEvent> sparse = new ArrayList<>(events.subList(0, 33)); // 仅开局 + 首次接敌（不含阵亡）
        final BattleTimelineResult tl = BattleTimelineBuilder.build(
                battle(120.0), recon(120.0, sparse), TimelinePerspective.team(1));
        assertTrue(tl.usable(), "timeline must be valid: " + tl.validation().errors());
        final String section = TeamAiContextCompiler.renderFocusWindowsSection(tl.timeline(), 1);
        // 允许空段（证据不足不编造）
        if (section.isBlank()) {
            return;
        }
        assertTrue(section.contains("OBSERVED FACTS"), "有窗口时必须输出 OBSERVED FACTS");
        assertFalse(section.contains("本方阵亡"), "稀疏证据不得编造阵亡");
        assertFalse(section.contains("没有掩体") || section.contains("位置感很好"),
                "不得输出战术归因断言");
    }
}