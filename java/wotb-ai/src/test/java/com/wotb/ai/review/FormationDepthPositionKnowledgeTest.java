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

class FormationDepthPositionKnowledgeTest {

    @Test
    void friendlyStationaryCarryForwardRemainsCurrent() {
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
        events.add(pos(10, 30f, 10, -100f, 0f));
        events.add(pos(11, 30f, 11, -200f, 0f));
        events.add(pos(12, 28f, 20, 200f, 0f));
        events.add(pos(13, 28f, 21, 230f, 50f));
        events.add(pos(14, 44f, 20, 200f, 0f));
        events.add(pos(15, 44f, 21, 230f, 50f));
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
        assertTrue(mid.contains("GEOMETRIC_FORWARD=account:1001"), mid);
        assertTrue(mid.contains("GEOMETRIC_REAR=account:1002"), mid);
        assertTrue(mid.contains("coverageCompleteness=ownRef=2/2 enemyRef=2/2"), mid);
    }

    @Test
    void enemyStalePositionRemainsLastKnown() {
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
        events.add(pos(10, 30f, 10, -100f, 0f));
        events.add(pos(11, 30f, 11, -200f, 0f));
        events.add(pos(12, 28f, 20, 200f, 0f));
        events.add(pos(13, 28f, 21, 230f, 50f));
        events.add(new com.wotb.core.replay.event.EntityRemovedEvent(40, new ReplayTimestamp(40f, null), 4,
                DecodeConfidence.EXACT, 20));
        events.add(new com.wotb.core.replay.event.EntityRemovedEvent(41, new ReplayTimestamp(40f, null), 4,
                DecodeConfidence.EXACT, 21));
        events.add(new com.wotb.core.replay.event.DamageEvent(30, new ReplayTimestamp(20.5f, null), 8,
                DecodeConfidence.EXACT, 11, 20, null, null, 200, false));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, recon, 1, MAP);

        assertTrue(section.contains("phase=mid"), section);
        final String mid = midBlock(section);
        assertTrue(mid.contains("POSITION_COVERAGE_INSUFFICIENT：ownRef=2/2 enemyRef=0/2"), mid);
        assertTrue(mid.contains("ENEMY_LAST_KNOWN_POSITION_REFERENCES"), mid);
        assertTrue(mid.contains("account:2001"), mid);
        assertTrue(mid.contains("observedAtSec=8.0"), mid);
        assertTrue(mid.contains("ageSec=17.0"), mid);
        assertTrue(mid.contains("knowledge=LAST_KNOWN"), mid);
        assertFalse(mid.contains("ownWeightedCoverageScore="), "stale enemy 不得产生 exact coverage 分数: " + mid);
        assertFalse(mid.contains("GEOMETRIC_FORWARD="), "stale enemy 不得作为 current enemy centroid: " + mid);
    }

    @Test
    void enemyInOpenObservedSegmentStaysCurrentBeyondAgeThreshold() {
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
        events.add(pos(10, 30f, 10, -100f, 0f));
        events.add(pos(11, 30f, 11, -200f, 0f));
        events.add(pos(12, 28f, 20, 200f, 0f));
        events.add(pos(13, 28f, 21, 230f, 50f));
        events.add(new com.wotb.core.replay.event.DamageEvent(30, new ReplayTimestamp(20.5f, null), 8,
                DecodeConfidence.EXACT, 11, 20, null, null, 200, false));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, recon, 1, MAP);
        assertTrue(section.contains("phase=mid"), section);
        final String mid = midBlock(section);
        assertTrue(mid.contains("coverageCompleteness=ownRef=2/2 enemyRef=2/2"),
                "open segment 内 age>5s 的 enemy 不得被踢出 exact geometry: " + mid);
        assertTrue(mid.contains("ownWeightedCoverageScore="), mid);
        assertTrue(mid.contains("enemyWeightedCoverageScore="), mid);
        assertFalse(mid.contains("POSITION_COVERAGE_INSUFFICIENT"),
                "open segment 内 enemy age>5s 不得误报 INSUFFICIENT: " + mid);
    }

    @Test
    void phasePositionDoesNotMixCoordinatesAcrossAoiGap() {
        final Battle battle = battle();
        battle.durationS = 60d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(pos(10, 20f, 20, 0f, 0f));
        events.add(new EntityRemovedEvent(11, new ReplayTimestamp(30f, null), 4,
                DecodeConfidence.EXACT, 20));
        events.add(new MaterializationEvent(12, new ReplayTimestamp(70f, null), 5,
                DecodeConfidence.EXACT, 20, 2, null, new byte[0], new byte[0]));
        events.add(pos(13, 75f, 20, 100f, 0f));
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
        final Battle battle = battle();
        battle.durationS = 40d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(pos(10, 20f, 20, 0f, 0f));
        events.add(new EntityRemovedEvent(11, new ReplayTimestamp(30f, null), 4,
                DecodeConfidence.EXACT, 20));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f,
                List.of(), events, List.of(), null, null, null);
        final TeamEntityMapping mapping = TeamEntityMapper.resolve(battle, recon);
        final Map<Integer, List<AoiObservationSegment>> aoiByEntity = ReplayAoiLifecycle.indexByEntity(
                ReplayAoiLifecycle.build(recon.events(), 20.0));
        final Map<Long, PlayerResult> playersByAccount = Map.of(2001L, player(2001L, 2, "EnemyA", 9297L));
        final List<FormationDepthEvidence.PositionSample> track = List.of(
                new FormationDepthEvidence.PositionSample(20, 0.0, 0.0, 0.0));
        final FormationDepthEvidence.PhasePositionReference ref =
                FormationDepthEvidence.resolvePhasePosition(
                        2001L, 2, track, 0.0, 30.0,
                        playersByAccount, mapping, aoiByEntity, 1);
        assertEquals(PositionKnowledge.LAST_KNOWN, ref.knowledge(),
                "phaseEnd ∈ UNKNOWN_AOI gap → 不产出 CURRENT（LAST_KNOWN，fail-closed）");
    }

    @Test
    void reentryOverlapUsesOnlySameEntitySamplesForCurrent() {
        final Battle battle = battle();
        battle.durationS = 20d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(21f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(21f, null), 8,
                DecodeConfidence.EXACT, 25, 2001L));
        events.add(pos(10, 23f, 20, 10f, 0f));
        events.add(pos(11, 29f, 20, 20f, 0f));
        events.add(new MaterializationEvent(12, new ReplayTimestamp(27f, null), 5,
                DecodeConfidence.EXACT, 25, 1, null, new byte[0], new byte[0]));
        events.add(pos(13, 28f, 25, 100f, 0f));
        events.add(pos(14, 30f, 25, 110f, 0f));
        events.add(new EntityRemovedEvent(15, new ReplayTimestamp(31f, null), 4,
                DecodeConfidence.EXACT, 20));
        events.add(new EntityRemovedEvent(16, new ReplayTimestamp(35f, null), 4,
                DecodeConfidence.EXACT, 25));
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
        final Battle battle = battle();
        battle.durationS = 20d;
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(21f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(21f, null), 8,
                DecodeConfidence.EXACT, 25, 2001L));
        events.add(pos(10, 23f, 20, 10f, 0f));
        events.add(pos(11, 29f, 20, 20f, 0f));
        events.add(new MaterializationEvent(12, new ReplayTimestamp(27f, null), 5,
                DecodeConfidence.EXACT, 25, 1, null, new byte[0], new byte[0]));
        events.add(pos(13, 28f, 25, 100f, 0f));
        events.add(pos(14, 30f, 25, 110f, 0f));
        events.add(new EntityRemovedEvent(15, new ReplayTimestamp(31f, null), 4,
                DecodeConfidence.EXACT, 20));
        events.add(new EntityRemovedEvent(16, new ReplayTimestamp(35f, null), 4,
                DecodeConfidence.EXACT, 25));
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
