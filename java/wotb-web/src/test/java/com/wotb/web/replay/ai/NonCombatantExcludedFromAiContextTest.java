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
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayMetadata;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;
import com.wotb.core.parse.ReplayStreamHeader;
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
 * PR #103 最终 review B1 回归：Canonical BattleTimeline 的 ActualCombatantEntitySet 过滤后，
 * Team / Personal AI Context Compiler 输出不得包含 spectator entity（车辆#99 / account 9999）。
 */
class NonCombatantExcludedFromAiContextTest {

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
                0, 0, 0, 0, 0, 0f, 0f, 0, Map.of(), true);
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(0, new ReplayTimestamp(1000f, 0f), 8,
                DecodeConfidence.EXACT, 1, 1001));
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(1000f, 0f), 8,
                DecodeConfidence.EXACT, 2, 1002));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(1000f, 0f), 8,
                DecodeConfidence.EXACT, 3, 2001));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(1000f, 0f), 8,
                DecodeConfidence.EXACT, 4, 2002));
        // spectator 99：broad-roster 完整身份（accountId=9999，team=2，tank 9489），但不在 #301
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(1000f, 0f), 8,
                DecodeConfidence.EXACT, 99, 9999));
        events.add(new PositionChangedEvent(5, new ReplayTimestamp(1000f, 0f), 10,
                DecodeConfidence.EXACT, 1, 0, 0, 0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0));
        events.add(new PositionChangedEvent(6, new ReplayTimestamp(1000f, 0f), 10,
                DecodeConfidence.EXACT, 2, 0, 0, 5f, 0f, 5f, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0));
        events.add(new PositionChangedEvent(7, new ReplayTimestamp(1000f, 0f), 10,
                DecodeConfidence.EXACT, 3, 0, 0, -20f, 0f, -20f, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0));
        events.add(new PositionChangedEvent(8, new ReplayTimestamp(1000f, 0f), 10,
                DecodeConfidence.EXACT, 4, 0, 0, -25f, 0f, -25f, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0));
        // spectator 99 连续位置流 + >5s gap + region teleport + 阵亡（若未被 #301 过滤会污染 delta）
        events.add(new PositionChangedEvent(9, new ReplayTimestamp(1005f, 5f), 10,
                DecodeConfidence.EXACT, 99, 0, 0, 100f, 0f, 100f, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0));
        events.add(new PositionChangedEvent(10, new ReplayTimestamp(1010f, 10f), 10,
                DecodeConfidence.EXACT, 99, 0, 0, 105f, 0f, 100f, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0));
        events.add(new PositionChangedEvent(11, new ReplayTimestamp(1025f, 25f), 10,
                DecodeConfidence.EXACT, 99, 0, 0, 500f, 0f, 500f, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0));
        events.add(new PositionChangedEvent(12, new ReplayTimestamp(1030f, 30f), 10,
                DecodeConfidence.EXACT, 99, 0, 0, 505f, 0f, 500f, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0));
        events.add(new PositionChangedEvent(13, new ReplayTimestamp(1050f, 50f), 10,
                DecodeConfidence.EXACT, 99, 0, 0, 600f, 0f, 600f, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0));
        events.add(new HealthChangedEvent(14, new ReplayTimestamp(1040f, 40f), 7,
                DecodeConfidence.EXACT, 99, 0, null, false));
        // 交火与 HP（产生 EPISODE）
        events.add(new HealthChangedEvent(15, new ReplayTimestamp(1000f, 0f), 7,
                DecodeConfidence.EXACT, 1, 1800, null, true));
        events.add(new HealthChangedEvent(16, new ReplayTimestamp(1000f, 0f), 7,
                DecodeConfidence.EXACT, 3, 1600, null, true));
        events.add(new DamageEvent(17, new ReplayTimestamp(1012f, 12f), 8,
                DecodeConfidence.EXACT, 1, 3, null, null, 420, false));
        events.add(new HealthChangedEvent(18, new ReplayTimestamp(1013f, 13f), 7,
                DecodeConfidence.EXACT, 3, 1180, null, true));
        final BattleStateCheckpoint cp = new BattleStateCheckpoint(1000f, 0, BattleStateSnapshot.empty());
        return new ReplayReconstruction(meta, header, 90f, 1000f,
                List.of(new BattleParticipant(9999L, "SpectatorCam", 2, 9489, "E 100", false)),
                events, List.of(cp), BattleStateSnapshot.empty(), coverage, diag);
    }

    @Test
    void compilersNeverRenderNonCombatantEntity() {
        final Battle battle = battle();
        final ReplayReconstruction recon = recon();
        final BattleTimelineResult tl = BattleTimelineBuilder.build(
                battle, recon, TimelinePerspective.team(1));
        assertTrue(tl.usable(), "fixture 必须能构建 timeline: " + tl.validation().errors());
        final BattleTimeline timeline = tl.timeline();

        // timeline universe 本身不含 spectator（最早层过滤）
        assertTrue(timeline.frames().stream()
                        .allMatch(f -> f.vehicles().stream().noneMatch(v -> v.entityId() == 99)),
                "spectator entity 99 不得进入任何 frame 的 FrameVehicle");

        final String teamSection = TeamAiContextCompiler.renderTimelineSection(timeline, 1);
        final String personalSection = PersonalAiContextCompiler.renderTimelineSection(timeline, 1001L);
        // 必须有 EPISODE（否则断言空转）
        assertTrue(teamSection.contains("EPISODE 1"), "team 段必须渲染 EPISODE");
        assertTrue(personalSection.contains("EPISODE 1"), "personal 段必须渲染 EPISODE");
        // spectator 不得以 车辆#99 或账号 9999 形式进入任何 AI 上下文
        assertFalse(teamSection.contains("车辆#99"),
                "Team AI timeline 不得出现 spectator 车辆#99:\n" + teamSection);
        assertFalse(personalSection.contains("车辆#99"),
                "Personal AI timeline 不得出现 spectator 车辆#99:\n" + personalSection);
        assertFalse(teamSection.contains("9999"), "Team AI timeline 不得出现 spectator 账号 9999");
        assertFalse(personalSection.contains("9999"), "Personal AI timeline 不得出现 spectator 账号 9999");
    }
}
