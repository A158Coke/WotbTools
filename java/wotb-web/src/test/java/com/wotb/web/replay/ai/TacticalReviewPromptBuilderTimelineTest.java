package com.wotb.web.replay.ai;

import com.wotb.core.ai.AiTokenEstimator;
import com.wotb.core.ai.ConservativeDeepSeekTokenEstimator;
import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.BattleLifecycle;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.LifeState;
import com.wotb.core.replay.reconstruction.ObservationState;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayMetadata;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.reconstruction.VehicleState;
import com.wotb.core.replay.reconstruction.Vector3;
import com.wotb.core.replay.stream.ReplayStreamDiagnostics;
import com.wotb.core.parse.ReplayStreamHeader;
import com.wotb.core.replay.timeline.BattleTimeline;
import com.wotb.core.replay.timeline.BattleTimelineBuilder;
import com.wotb.core.replay.timeline.BattleTimelineResult;
import com.wotb.core.replay.timeline.TimelinePerspective;
import com.wotb.core.replay.evidence.AiEvidence;
import com.wotb.core.replay.evidence.EvidencePriority;
import com.wotb.core.replay.evidence.EvidenceProvenance;
import com.wotb.core.replay.evidence.EvidenceSkillResult;
import com.wotb.core.replay.evidence.EvidenceType;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.processing.RecorderEntityMapping;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Call #2 prompt 时间线化：提供 canonical timeline 时必须注入 TACTICAL TIMELINE 段，
 * 且书签段（SNAPSHOT/PRIOR/TASK）保持完整。
 */
class TacticalReviewPromptBuilderTimelineTest {

    private static final AiTokenEstimator ESTIMATOR = new ConservativeDeepSeekTokenEstimator();

    private static Battle battle() {
        final List<PlayerResult> players = new ArrayList<>();
        final PlayerResult rec = new PlayerResult();
        rec.accountId = 1001;
        rec.team = 1;
        rec.tankId = 4481;
        rec.tankName = "Kranvagn";
        rec.nickname = "rec1";
        rec.survived = true;
        players.add(rec);
        final PlayerResult enemy = new PlayerResult();
        enemy.accountId = 2001;
        enemy.team = 2;
        enemy.tankId = 14609;
        enemy.tankName = "Leopard 1";
        enemy.nickname = "enemy1";
        enemy.survived = false;
        enemy.deathTimeMillis = 90_000;
        enemy.survivalTimeSec = 90.0;
        players.add(enemy);
        final Battle b = new Battle();
        b.mapName = "middleburg";
        b.arenaBonusType = 1;
        b.durationS = 150.0;
        b.recorder = "rec1";
        b.players = players;
        return b;
    }

    private static ReplayReconstruction recon() {
        final ReplayMetadata meta = new ReplayMetadata(
                "arena", "middleburg", "1", "1", 1, "rec1", "", 150.0, 0L);
        final ReplayStreamHeader header = new ReplayStreamHeader(0x12345678L, new byte[8], "h", "v", 15);
        final ReplayCoverage coverage = new ReplayCoverage(6, 6, 0, 0, 0, 1.0, Map.of());
        final ReplayStreamDiagnostics diag = new ReplayStreamDiagnostics(0, 0, 0f, 0f, 0, Map.of());
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(0, new ReplayTimestamp(1000f, 0f), 8,
                DecodeConfidence.EXACT, 1, 1001));
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(1000f, 0f), 8,
                DecodeConfidence.EXACT, 4, 2001));
        events.add(new PositionChangedEvent(2, new ReplayTimestamp(1000f, 0f), 10,
                DecodeConfidence.EXACT, 1, 0, 0, 0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0));
        events.add(new PositionChangedEvent(3, new ReplayTimestamp(1000f, 0f), 10,
                DecodeConfidence.EXACT, 4, 0, 0, -20f, 0f, -20f, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0));
        events.add(new HealthChangedEvent(4, new ReplayTimestamp(1000f, 0f), 7,
                DecodeConfidence.EXACT, 1, 1800, null, true));
        events.add(new HealthChangedEvent(5, new ReplayTimestamp(1000f, 0f), 7,
                DecodeConfidence.EXACT, 4, 1600, null, true));
        // 首次接敌 + 敌方掉血：产生 episode 信号
        events.add(new DamageEvent(6, new ReplayTimestamp(1010f, 10f), 8,
                DecodeConfidence.EXACT, 1, 4, null, null, 420, false));
        events.add(new HealthChangedEvent(7, new ReplayTimestamp(1011f, 11f), 7,
                DecodeConfidence.EXACT, 4, 1180, null, true));
        events.add(new PositionChangedEvent(8, new ReplayTimestamp(1011f, 11f), 10,
                DecodeConfidence.EXACT, 4, 0, 0, -22f, 0f, -22f, 0f, 0f, 0f, 0f, 0f, 0f, (byte) 0));
        // 敌方阵亡于 90s
        events.add(new HealthChangedEvent(9, new ReplayTimestamp(1090f, 90f), 7,
                DecodeConfidence.EXACT, 4, 0, null, false));
        final BattleStateCheckpoint cp = new BattleStateCheckpoint(1000f, 0,
                BattleStateSnapshot.empty());
        return new ReplayReconstruction(meta, header, 150f, 1000f, List.of(),
                events, List.of(cp), BattleStateSnapshot.empty(), coverage, diag);
    }

    private static PreBattleStrategicPrior prior() {
        return new PreBattleStrategicPrior(
                new PreBattleStrategicPrior.TeamProfile(Map.of(), List.of(), List.of(), List.of()),
                new PreBattleStrategicPrior.TeamProfile(Map.of(), List.of(), List.of(), List.of()),
                List.of(), List.of(),
                List.of(new PreBattleStrategicPrior.StrategicHypothesis("H1", "cl", "rs")));
    }

    private static EvidenceSkillResult evidence() {
        final AiEvidence window = new AiEvidence(
                "CW_01", EvidenceType.CRITICAL_WINDOW, 85f, 95f,
                List.of(), Map.of("friendlyDeaths", 1.0), Map.of(),
                DecodeConfidence.PARTIAL, EvidencePriority.CRITICAL,
                EvidenceProvenance.BACKEND_SKILL, "窗口证据");
        return new EvidenceSkillResult(List.of(), List.of(window), List.of());
    }

    @Test
    void timelineSectionInjectedAfterPriorWithBookends() {
        final Battle battle = battle();
        final ReplayReconstruction recon = recon();
        final BattleTimelineResult tl = BattleTimelineBuilder.build(
                battle, recon, TimelinePerspective.personal(1001L, 1));
        assertTrue(tl.usable(), "测试 fixture 必须能构建 timeline: " + tl.validation().errors());
        final BattleTimeline timeline = tl.timeline();

        final var prepared = TacticalReviewPromptBuilder.prepare(
                prior(), evidence(), battle, recon, timeline,
                new PlayerBattleFeatureSet(List.of(), List.of(), List.of(), List.of(), List.of(), true),
                new RecorderEntityMapping(1001L, 4481, 1, "rec1", 1, 4481, DecodeConfidence.EXACT),
                ESTIMATOR, 100_000, 131_072, 8192, 1000);

        final String content = prepared.userContent();
        assertTrue(content.contains("TACTICAL TIMELINE"), "必须注入 TACTICAL TIMELINE 段");
        assertTrue(content.contains("EPISODE 1"), "时间线段必须包含 Episode 章节");
        assertTrue(content.contains("BEFORE friendly_alive="), "Episode 必须包含双方世界状态");
        assertTrue(content.contains("首次接敌"), "Episode 必须表达首次接敌（FIRST_CONTACT）");
        assertTrue(content.contains("信息空窗期损失约") || content.contains("HP"),
                "Episode 必须表达 HP 变化语义");
        // 书签段保持
        assertTrue(content.contains("BATTLE SNAPSHOT"));
        assertTrue(content.contains("PRE-BATTLE STRATEGIC PRIOR"));
        assertTrue(content.contains("======================== TASK"));
        // 顺序：SNAPSHOT → PRIOR → TIMELINE → TASK
        assertTrue(content.indexOf("TACTICAL TIMELINE") > content.indexOf("PRE-BATTLE STRATEGIC PRIOR"));
        assertTrue(content.indexOf("======================== TASK") > content.indexOf("TACTICAL TIMELINE"));
    }
}
