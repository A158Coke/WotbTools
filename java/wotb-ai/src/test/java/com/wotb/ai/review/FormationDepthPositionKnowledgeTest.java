package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.EntityRemovedEvent;
import com.wotb.core.replay.event.MaterializationEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.facts.AoiObservationSegment;
import com.wotb.core.replay.facts.ReplayAoiLifecycle;
import com.wotb.core.replay.processing.TeamEntityMapper;
import com.wotb.core.replay.processing.TeamEntityMapping;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import com.wotb.core.replay.timeline.PositionKnowledge;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import static com.wotb.ai.review.FormationDepthEvidenceTestSupport.MAP;
import static com.wotb.ai.review.FormationDepthEvidenceTestSupport.battle;
import static com.wotb.ai.review.FormationDepthEvidenceTestSupport.midBlock;
import static com.wotb.ai.review.FormationDepthEvidenceTestSupport.player;
import static com.wotb.ai.review.FormationDepthEvidenceTestSupport.pos;

/** Formation depth PositionKnowledgetests */
class FormationDepthPositionKnowledgeTest {

    @Test
    void friendlyStationaryCarryForwardRemainsCurrent() {
        // A：己方 actual combatant 在 phase 前有最后位置、phase 内无新 PositionChanged、无 EntityLeave、未阵亡
        // → friendly carry-forward 保持 CURRENT（canonical knowledge 契约），仍参与 current formation reference。
        // 敌方在 mid 内保持新鲜（CURRENT）→ exact coverage/几何正常输出，不得 POSITION_COVERAGE_INSUFFICIENT。
        // 2026-08-19 真实样本（Maus holland）：存活己方开局静止 10.8s 同坐标无新位置。
        final Battle battle = battle();
        battle.durationS = 40d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        // 己方所有位置只在 opening（t=10）：mid [15.5,25] 内无新样本 → carry-forward（friendly=CURRENT）
        events.add(pos(10, 30f, 10, -100f, 0f));   // 1001 t=10
        events.add(pos(11, 30f, 11, -200f, 0f));   // 1002 t=10
        // 敌方 opening t=8 + mid 内 t=24（≤25 且 age=1 ≤ 当前阈值）→ mid 内 CURRENT
        events.add(pos(12, 28f, 20, 200f, 0f));    // 2001 t=8
        events.add(pos(13, 28f, 21, 230f, 50f));   // 2002 t=8
        events.add(pos(14, 44f, 20, 200f, 0f));    // 2001 t=24
        events.add(pos(15, 44f, 21, 230f, 50f));   // 2002 t=24
        // 交火 t=0.5 → opening [0,15.5] / mid [15.5,25] / late [25,40]
        events.add(new com.wotb.core.replay.event.DamageEvent(30, new ReplayTimestamp(20.5f, null), 8,
                DecodeConfidence.EXACT, 11, 20, null, null, 200, false));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, recon, 1, MAP);

        assertTrue(section.contains("phase=mid"), section);
        final String mid = midBlock(section);
        assertFalse(mid.contains("POSITION_COVERAGE_INSUFFICIENT"),
                "friendly carry-forward（CURRENT）不得判位置覆盖不足: " + mid);
        assertTrue(mid.contains("REGION_COVERAGE_MEASUREMENTS"), mid);
        // 己方 1001（靠敌）仍出现在 mid 的几何纵深（carry-forward 位置参与 current 阵型）
        assertTrue(mid.contains("GEOMETRIC_FORWARD=account:1001"), mid);
        assertTrue(mid.contains("GEOMETRIC_REAR=account:1002"), mid);
        assertTrue(mid.contains("coverageCompleteness=ownRef=2/2 enemyRef=2/2"), mid);
    }

    @Test
    void enemyStalePositionRemainsLastKnown() {
        // B：enemy 最后位置 t=8（mid 前），phaseEnd=25（>15），mid 内无新位置
        // → enemy carry-forward 必须保持 LAST_KNOWN：不得满足 current completeness、不得形成 exact
        //   current coverage/distance、不得 future-leak；只输出 INSUFFICIENT + ENEMY_LAST_KNOWN_POSITION_REFERENCES。
        final Battle battle = battle();
        battle.durationS = 40d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        // 双方所有位置都只在 opening：mid [15.5,25] 内无任何新样本
        events.add(pos(10, 30f, 10, -100f, 0f));   // 1001 t=10
        events.add(pos(11, 30f, 11, -200f, 0f));   // 1002 t=10
        events.add(pos(12, 28f, 20, 200f, 0f));    // 2001 t=8
        events.add(pos(13, 28f, 21, 230f, 50f));   // 2002 t=8
        // P0-1：enemy 在 t=20 离开（Type4）→ observed segment [8,20) 关闭 → mid 末（25）位于
        // UNKNOWN_AOI gap → enemy carry-forward 必须 LAST_KNOWN（fail-closed，不进 exact geometry）。
        events.add(new com.wotb.core.replay.event.EntityRemovedEvent(40, new ReplayTimestamp(40f, null), 4,
                DecodeConfidence.EXACT, 20));
        events.add(new com.wotb.core.replay.event.EntityRemovedEvent(41, new ReplayTimestamp(40f, null), 4,
                DecodeConfidence.EXACT, 21));
        // 交火 t=0.5 → opening [0,15.5] / mid [15.5,25] / late [25,40]
        events.add(new com.wotb.core.replay.event.DamageEvent(30, new ReplayTimestamp(20.5f, null), 8,
                DecodeConfidence.EXACT, 11, 20, null, null, 200, false));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, recon, 1, MAP);

        assertTrue(section.contains("phase=mid"), section);
        final String mid = midBlock(section);
        // friendly carry-forward 仍 CURRENT（ownRef=2/2），enemy 位于 UNKNOWN_AOI gap → LAST_KNOWN（enemyRef=0/2）
        assertTrue(mid.contains("POSITION_COVERAGE_INSUFFICIENT：ownRef=2/2 enemyRef=0/2"), mid);
        // LAST_KNOWN 只作为独立信息：account + region + observedAtSec + ageSec + knowledge=LAST_KNOWN
        assertTrue(mid.contains("ENEMY_LAST_KNOWN_POSITION_REFERENCES"), mid);
        assertTrue(mid.contains("account:2001"), mid);
        assertTrue(mid.contains("observedAtSec=8.0"), mid);
        assertTrue(mid.contains("ageSec=17.0"), mid);
        assertTrue(mid.contains("knowledge=LAST_KNOWN"), mid);
        // 不得把 stale enemy 当 current：无 exact 分数、无几何纵深（enemy CURRENT centroid 缺失）
        assertFalse(mid.contains("ownWeightedCoverageScore="), "stale enemy 不得产生 exact coverage 分数: " + mid);
        assertFalse(mid.contains("GEOMETRIC_FORWARD="), "stale enemy 不得作为 current enemy centroid: " + mid);
    }

    @Test
    void enemyInOpenObservedSegmentStaysCurrentBeyondAgeThreshold() {
        // P0-1 回归：enemy 位置在 opening t=8，mid 末（25）远大于 5s（age=17），无 Type4 →
        // observed segment [8,..) 保持打开 → enemy 仍 CURRENT（不得因 age>5s 被踢出 exact geometry）。
        final Battle battle = battle();
        battle.durationS = 40d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 30f, 10, -100f, 0f));   // 1001 t=10
        events.add(pos(11, 30f, 11, -200f, 0f));   // 1002 t=10
        events.add(pos(12, 28f, 20, 200f, 0f));    // 2001 t=8
        events.add(pos(13, 28f, 21, 230f, 50f));   // 2002 t=8
        // 无 Type4（leave）→ enemy observed segment 持续打开；carry-forward 的 enemy 在 mid[CURRENT]
        events.add(new com.wotb.core.replay.event.DamageEvent(30, new ReplayTimestamp(20.5f, null), 8,
                DecodeConfidence.EXACT, 11, 20, null, null, 200, false));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, recon, 1, MAP);
        assertTrue(section.contains("phase=mid"), section);
        final String mid = midBlock(section);
        // enemy 位于 open observed segment（age=17 > 5s）→ 仍 CURRENT，完整 → 不 fail-close，输出 exact 分数
        assertTrue(mid.contains("coverageCompleteness=ownRef=2/2 enemyRef=2/2"),
                "open segment 内 age>5s 的 enemy 不得被踢出 exact geometry: " + mid);
        assertTrue(mid.contains("ownWeightedCoverageScore="), mid);
        assertTrue(mid.contains("enemyWeightedCoverageScore="), mid);
        assertFalse(mid.contains("POSITION_COVERAGE_INSUFFICIENT"),
                "open segment 内 enemy age>5s 不得误报 INSUFFICIENT: " + mid);
    }

    @Test
    void phasePositionDoesNotMixCoordinatesAcrossAoiGap() {
        // P0-1（Deep Review）：phase [0,60]，敌方实体在 segment A（t=0, x=0）→ Type4@10 →
        // UNKNOWN_AOI gap → Type5@50 re-entry → segment B（t=55, x=100）。phaseEnd=60 属 segment B。
        // resolvePhasePosition 的 CURRENT 参考必须只来自 segment B（x≈100），不得把 A+B 平均（x≈50）。
        final Battle battle = battle();
        battle.durationS = 60d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(pos(10, 20f, 20, 0f, 0f));                     // t=0   segment A x=0
        events.add(new EntityRemovedEvent(11, new ReplayTimestamp(30f, null), 4,
                DecodeConfidence.EXACT, 20));                    // leave@10
        events.add(new MaterializationEvent(12, new ReplayTimestamp(70f, null), 5,
                DecodeConfidence.EXACT, 20, 2, null, new byte[0], new byte[0])); // re-enter@50
        events.add(pos(13, 75f, 20, 100f, 0f));                   // t=55   segment B x=100
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f,
                List.of(), events, List.of(), null, null, null);
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
        final Map<Integer, List<AoiObservationSegment>> aoiByEntity = ReplayAoiLifecycle.indexByEntity(
                ReplayAoiLifecycle.build(recon.events(), 20.0));
        final Map<Long, PlayerResult> playersByAccount = Map.of(2001L, player(2001L, 2, "EnemyA", 9297L));
        final List<FormationDepthEvidence.PositionSample> track = List.of(
                new FormationDepthEvidence.PositionSample(20, 0.0, 0.0, 0.0),
                new FormationDepthEvidence.PositionSample(20, 55.0, 100.0, 0.0));

        final FormationDepthEvidence.PhasePositionReference ref =
                FormationDepthEvidence.resolvePhasePosition(
                        2001L, 2, track, 0.0, 60.0,
                        playersByAccount, mapping, aoiByEntity, 1);
        assertEquals(PositionKnowledge.CURRENT, ref.knowledge(),
                "phaseEnd 属 segment B → CURRENT");
        assertEquals(100.0, ref.x(), 1e-6,
                "CURRENT 参考必须只来自 phaseEnd 的 observed segment（segment B），不得与 segment A 平均成 50");
    }

    @Test
    void phasePositionInAoiGapIsNotCurrent() {
        // P0-1：phaseEnd ∈ UNKNOWN_AOI gap（无 observed segment）→ 不产出 CURRENT exact geometry。
        final Battle battle = battle();
        battle.durationS = 40d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(pos(10, 20f, 20, 0f, 0f));                     // t=0   segment A x=0
        events.add(new EntityRemovedEvent(11, new ReplayTimestamp(30f, null), 4,
                DecodeConfidence.EXACT, 20));                    // leave@10
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f,
                List.of(), events, List.of(), null, null, null);
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
        final Map<Integer, List<AoiObservationSegment>> aoiByEntity = ReplayAoiLifecycle.indexByEntity(
                ReplayAoiLifecycle.build(recon.events(), 20.0));
        final Map<Long, PlayerResult> playersByAccount = Map.of(2001L, player(2001L, 2, "EnemyA", 9297L));
        final List<FormationDepthEvidence.PositionSample> track = List.of(
                new FormationDepthEvidence.PositionSample(20, 0.0, 0.0, 0.0));
        // phaseEnd=30 处于 leave 之后（segment A [0,10) 已关闭）→ UNKNOWN_AOI gap → 非 CURRENT（LAST_KNOWN）
        final FormationDepthEvidence.PhasePositionReference ref =
                FormationDepthEvidence.resolvePhasePosition(
                        2001L, 2, track, 0.0, 30.0,
                        playersByAccount, mapping, aoiByEntity, 1);
        assertEquals(PositionKnowledge.LAST_KNOWN, ref.knowledge(),
                "phaseEnd ∈ UNKNOWN_AOI gap → 不产出 CURRENT（LAST_KNOWN，fail-closed）");
    }

    @Test
    void reentryOverlapUsesOnlySameEntitySamplesForCurrent() {
        // Item P1 回归：account 2001 跨越两个实体生命周期（re-entry 重叠）。
        // 实体 A(20) 观测段 [2,10)（t=2..8 有位置）→ Type4@10 关闭（terminal/destroyed）；
        // 实体 B(25) 于 t=6 重入（Materialization）且延续到 t=14（Type4）→ B 观测段 [6,14)。
        // phaseEnd=10 位于 B(25) 的 observed segment → CURRENT 参考必须只消费 B(25) 的样本（x=100/110 → 105），
        // 不得把 A(20) 的 t=8 x=20 并入（旧的 accountId-flattened track 会把 A 的 x=20 一起平均成 76.67）。
        final Battle battle = battle();
        battle.durationS = 20d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(21f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(21f, null), 8,
                DecodeConfidence.EXACT, 25, 2001L));
        events.add(pos(10, 23f, 20, 10f, 0f));   // A t=2 x=10
        events.add(pos(11, 29f, 20, 20f, 0f));   // A t=8 x=20
        events.add(new MaterializationEvent(12, new ReplayTimestamp(27f, null), 5,
                DecodeConfidence.EXACT, 25, 1, null, new byte[0], new byte[0])); // B re-enter t=6
        events.add(pos(13, 28f, 25, 100f, 0f));  // B t=7 x=100
        events.add(pos(14, 30f, 25, 110f, 0f));  // B t=9 x=110
        events.add(new EntityRemovedEvent(15, new ReplayTimestamp(31f, null), 4,
                DecodeConfidence.EXACT, 20));    // A terminal t=10
        events.add(new EntityRemovedEvent(16, new ReplayTimestamp(35f, null), 4,
                DecodeConfidence.EXACT, 25));    // B leave t=14
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 21f,
                List.of(), events, List.of(), null, null, null);
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
        final Map<Integer, List<AoiObservationSegment>> aoiByEntity = ReplayAoiLifecycle.indexByEntity(
                ReplayAoiLifecycle.build(recon.events(), 21.0));
        final Map<Long, PlayerResult> playersByAccount = Map.of(2001L, player(2001L, 2, "EnemyA", 9297L));
        final List<FormationDepthEvidence.PositionSample> samples = List.of(
                new FormationDepthEvidence.PositionSample(20, 2.0, 10.0, 0.0),
                new FormationDepthEvidence.PositionSample(20, 8.0, 20.0, 0.0),
                new FormationDepthEvidence.PositionSample(25, 7.0, 100.0, 0.0),
                new FormationDepthEvidence.PositionSample(25, 9.0, 110.0, 0.0));

        final FormationDepthEvidence.PhasePositionReference ref =
                FormationDepthEvidence.resolvePhasePosition(
                        2001L, 2, samples, 0.0, 10.0,
                        playersByAccount, mapping, aoiByEntity, 1);
        assertEquals(PositionKnowledge.CURRENT, ref.knowledge(),
                "phaseEnd=10 位于 B(25) observed segment → CURRENT");
        assertEquals(105.0, ref.x(), 1e-6,
                "CURRENT 参考只消费 B(25) 样本（(100+110)/2=105），不得并入 A(20) 的 x=20");
    }

    @Test
    void reentryGapAfterEntityCloseIsLastKnown() {
        // Item P1 回归：phaseEnd=16 处于 B(25) 段关闭后的 UNKNOWN_AOI gap（A、B 均 Type4 关闭）
        // → 同实体 carry-forward 退化为 LAST_KNOWN，不得当作 CURRENT（fail-closed）。
        final Battle battle = battle();
        battle.durationS = 20d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(21f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(21f, null), 8,
                DecodeConfidence.EXACT, 25, 2001L));
        events.add(pos(10, 23f, 20, 10f, 0f));   // A t=2 x=10
        events.add(pos(11, 29f, 20, 20f, 0f));   // A t=8 x=20
        events.add(new MaterializationEvent(12, new ReplayTimestamp(27f, null), 5,
                DecodeConfidence.EXACT, 25, 1, null, new byte[0], new byte[0])); // B re-enter t=6
        events.add(pos(13, 28f, 25, 100f, 0f));  // B t=7 x=100
        events.add(pos(14, 30f, 25, 110f, 0f));  // B t=9 x=110
        events.add(new EntityRemovedEvent(15, new ReplayTimestamp(31f, null), 4,
                DecodeConfidence.EXACT, 20));    // A terminal t=10
        events.add(new EntityRemovedEvent(16, new ReplayTimestamp(35f, null), 4,
                DecodeConfidence.EXACT, 25));    // B leave t=14
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 21f,
                List.of(), events, List.of(), null, null, null);
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
        final Map<Integer, List<AoiObservationSegment>> aoiByEntity = ReplayAoiLifecycle.indexByEntity(
                ReplayAoiLifecycle.build(recon.events(), 21.0));
        final Map<Long, PlayerResult> playersByAccount = Map.of(2001L, player(2001L, 2, "EnemyA", 9297L));
        final List<FormationDepthEvidence.PositionSample> samples = List.of(
                new FormationDepthEvidence.PositionSample(20, 2.0, 10.0, 0.0),
                new FormationDepthEvidence.PositionSample(20, 8.0, 20.0, 0.0),
                new FormationDepthEvidence.PositionSample(25, 7.0, 100.0, 0.0),
                new FormationDepthEvidence.PositionSample(25, 9.0, 110.0, 0.0));

        final FormationDepthEvidence.PhasePositionReference ref =
                FormationDepthEvidence.resolvePhasePosition(
                        2001L, 2, samples, 0.0, 16.0,
                        playersByAccount, mapping, aoiByEntity, 1);
        assertEquals(PositionKnowledge.LAST_KNOWN, ref.knowledge(),
                "phaseEnd=16 位于 UNKNOWN_AOI gap → LAST_KNOWN（fail-closed，不作 CURRENT）");
        assertEquals(110.0, ref.x(), 1e-6,
                "LAST_KNOWN 取 B(25) 最后一次样本（t=9 x=110），保持单实体来源");
    }

}
