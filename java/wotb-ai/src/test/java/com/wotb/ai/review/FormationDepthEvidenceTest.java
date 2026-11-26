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
import static com.wotb.ai.review.FormationDepthEvidenceTestSupport.reconWithPositions;

class FormationDepthEvidenceTest {

    @Test
    void rendersGeometricTercilesAndCoverageMeasurements() {
        final String section = FormationDepthEvidence.renderSection(battle(), reconWithPositions(20f), 1, MAP);
        assertTrue(section.contains("=== FORMATION_DEPTH"), section);
        assertTrue(section.contains("phase=opening"), section);
        assertTrue(section.contains("GEOMETRIC_FORWARD=account:1001"), section);
        assertTrue(section.contains("GEOMETRIC_REAR=account:1002"), section);
        assertTrue(section.contains("GEOMETRIC_FORWARD=account:1001(HEAVY"), section);
        assertFalse(section.contains("frontlineCapable"), "不得输出 frontlineCapable 标签: " + section);
        assertFalse(section.contains("backlineCapable"), "不得输出 backlineCapable 标签");
        assertFalse(section.contains("lineupStructure"), "不得输出 lineupStructure 战术角色结构行");
        assertFalse(section.contains("noFrontlineVehicle"), "不得输出 noFrontlineVehicle");
        assertFalse(section.contains("noBacklineVehicle"), "不得输出 noBacklineVehicle");
        assertTrue(section.contains("REGION_COVERAGE_MEASUREMENTS"), section);
        assertTrue(section.contains("ownPositionPresence="), section);
        assertTrue(section.contains("enemyPositionPresence="), section);
        assertTrue(section.contains("ownWeightedCoverageScore="), section);
        assertTrue(section.contains("coverageCompleteness="), section);
        assertFalse(section.contains("controlRegions own="), "不得输出 controlRegions own 权威标签");
        assertFalse(section.contains("controlRegions enemy="), "不得输出 controlRegions enemy 权威标签");
        assertFalse(section.contains("controlRegions contested="), "不得输出 controlRegions contested 权威标签");
    }

    @Test
    void emptyWithoutReconOrMapping() {
        assertTrue(FormationDepthEvidence.renderSection(battle(), null, 1, MAP).isEmpty());
        final Battle empty = battle();
        empty.players = List.of();
        assertTrue(FormationDepthEvidence.renderSection(empty, reconWithPositions(20f), 1, MAP).isEmpty());
    }

    @Test
    void enemyPositionsMissingFailsClosedControlRegions() {
        final ReplayReconstruction recon = reconWithPositions(20f);
        final Battle battle = battle();
        final List<ReplayEvent> filtered = recon.events().stream()
                .filter(e -> !(e instanceof ParticipantMappingEvent m)
                        || (m.entityId() != 20 && m.entityId() != 21))
                .toList();
        final ReplayReconstruction ownOnly = new ReplayReconstruction(null, null, 100f, 20f,
                List.of(), new ArrayList<>(filtered), List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, ownOnly, 1, MAP);
        assertTrue(section.contains("POSITION_COVERAGE_INSUFFICIENT"), section);
        assertTrue(section.contains("REGION_COVERAGE_MEASUREMENTS"), section);
        assertTrue(section.contains("ownPositionPresence=GRID_REGION_"), section);
        assertFalse(section.contains("ownWeightedCoverageScore="), "敌方无位置参考时不得输出分数对比");
        assertFalse(section.contains("GEOMETRIC_FORWARD="), "敌方无位置观测时不得输出几何纵深");
    }


    @Test
    void geometricTercilesAlwaysEmittedRegardlessOfProfile() {
        final Battle battle = battle();
        battle.players = List.of(
                player(1001L, 1, "AllyA", 9297L),
                player(1002L, 1, "AllyB", 9297L),
                player(2001L, 2, "EnemyA", 9489L),
                player(2002L, 2, "EnemyB", 9489L));
        final String section = FormationDepthEvidence.renderSection(battle, reconWithPositions(20f), 1, MAP);
        assertTrue(section.contains("GEOMETRIC_FORWARD=account:1001"), section);
        assertTrue(section.contains("GEOMETRIC_REAR=account:1002"), section);
        assertFalse(section.contains("frontlineCapable"), "全 TD 阵容不得输出 frontlineCapable: " + section);
        assertFalse(section.contains("noFrontlineVehicle"), "不得输出 noFrontlineVehicle");
        assertFalse(section.contains("backlineCapable"), "不得输出 backlineCapable");
        assertFalse(section.contains("noBacklineVehicle"), "不得输出 noBacklineVehicle");
    }

    @Test
    void geometricTercilesStillEmittedForAllHeavyAndAllMediumLineups() {
        final Battle heavyBattle = battle();
        heavyBattle.players = List.of(
                player(1001L, 1, "AllyA", 9489L),
                player(1002L, 1, "AllyB", 9489L),
                player(2001L, 2, "EnemyA", 9297L),
                player(2002L, 2, "EnemyB", 9297L));
        final String heavySection = FormationDepthEvidence.renderSection(heavyBattle, reconWithPositions(20f), 1, MAP);
        assertTrue(heavySection.contains("GEOMETRIC_FORWARD=account:1001"), heavySection);
        assertTrue(heavySection.contains("GEOMETRIC_REAR=account:1002"), heavySection);
        assertFalse(heavySection.contains("backlineCapable"), heavySection);
        assertFalse(heavySection.contains("noBacklineVehicle"), heavySection);

        final Battle mediumBattle = battle();
        mediumBattle.players = List.of(
                player(1001L, 1, "AllyA", 385L),
                player(1002L, 1, "AllyB", 385L),
                player(2001L, 2, "EnemyA", 9489L),
                player(2002L, 2, "EnemyB", 9297L));
        final String mediumSection = FormationDepthEvidence.renderSection(mediumBattle, reconWithPositions(20f), 1, MAP);
        assertTrue(mediumSection.contains("GEOMETRIC_FORWARD=account:1001"), mediumSection);
        assertTrue(mediumSection.contains("GEOMETRIC_REAR=account:1002"), mediumSection);
        assertFalse(mediumSection.contains("frontlineCapable"), mediumSection);
        assertFalse(mediumSection.contains("noFrontlineVehicle"), mediumSection);
    }










    @Test
    void noTacticalRoleLabelsInAnyLineupComposition() {
        final Battle battle = battle();
        battle.players = List.of(
                player(1001L, 1, "AllyA", 9489L),
                player(1002L, 1, "AllyB", 17745L),
                player(2001L, 2, "EnemyA", 9489L),
                player(2002L, 2, "EnemyB", 9489L));
        final String section = FormationDepthEvidence.renderSection(battle, reconWithPositions(20f), 1, MAP);
        assertTrue(section.contains("GEOMETRIC_FORWARD="), section);
        assertTrue(section.contains("GEOMETRIC_REAR="), section);
        assertFalse(section.contains("lineupStructure"), "不得输出 lineupStructure: " + section);
        assertFalse(section.contains("frontlineCapable"), section);
        assertFalse(section.contains("backlineCapable"), section);
        assertFalse(section.contains("noFrontlineVehicle"), section);
        assertFalse(section.contains("noBacklineVehicle"), section);
        assertFalse(section.contains("neutralOnly"), section);
    }

    @Test
    void postDeathPositionsExcludedFromFormation() {
        final Battle battle = battle();
        battle.durationS = 100d;
        for (final PlayerResult pl : battle.players) {
            if (pl.accountId == 1001L) {
                pl.survived = false;
                pl.deathTimeMillis = 50_000L;
                pl.settlementLifeTimeSec = 50;
            }
        }
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
        events.add(pos(11, 42f, 10, -90f, 0f));
        events.add(pos(12, 90f, 10, -110f, 0f));
        events.add(pos(13, 100f, 10, -115f, 0f));
        events.add(pos(14, 40f, 11, -200f, 0f));
        events.add(pos(15, 60f, 11, -190f, 0f));
        events.add(pos(20, 40f, 20, 200f, 0f));
        events.add(pos(21, 60f, 20, 210f, 0f));
        events.add(pos(22, 40f, 21, 230f, 50f));
        events.add(pos(23, 60f, 21, 235f, 50f));
        events.add(new com.wotb.core.replay.event.DamageEvent(30, new ReplayTimestamp(50f, null), 8,
                DecodeConfidence.EXACT, 11, 20, null, null, 200, false));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, recon, 1, MAP);
        assertTrue(section.contains("phase=mid"), section);
        final String midLate = section.substring(section.indexOf("phase=mid"));
        assertFalse(midLate.contains("account:1001"), "阵亡后位置残留不得进入 mid/late 阵型名单, got: " + midLate);
    }









    @Test
    void partialEnemyCurrentDoesNotProduceGeometricTerciles() {
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
        events.add(new com.wotb.core.replay.event.EntityRemovedEvent(31, new ReplayTimestamp(40f, null), 4,
                DecodeConfidence.EXACT, 21));
        events.add(new com.wotb.core.replay.event.DamageEvent(30, new ReplayTimestamp(20.5f, null), 8,
                DecodeConfidence.EXACT, 11, 20, null, null, 200, false));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = FormationDepthEvidence.renderSection(battle, recon, 1, MAP);

        assertTrue(section.contains("phase=mid"), section);
        final String mid = midBlock(section);
        assertTrue(mid.contains("POSITION_COVERAGE_INSUFFICIENT：ownRef=2/2 enemyRef=1/2"), mid);
        assertTrue(mid.contains("ENEMY_LAST_KNOWN_POSITION_REFERENCES"), mid);
        assertTrue(mid.contains("account:2002"), "LAST_KNOWN 独立信息必须包含 stale enemy 2002: " + mid);
        assertFalse(mid.contains("GEOMETRIC_FORWARD="), "partial enemy CURRENT 不得输出 GEOMETRIC_FORWARD: " + mid);
        assertFalse(mid.contains("GEOMETRIC_MIDDLE="), "partial enemy CURRENT 不得输出 GEOMETRIC_MIDDLE: " + mid);
        assertFalse(mid.contains("GEOMETRIC_REAR="), "partial enemy CURRENT 不得输出 GEOMETRIC_REAR: " + mid);
        assertFalse(mid.contains("ownWeightedCoverageScore="), "partial enemy CURRENT 不得输出 own 分数: " + mid);
        assertFalse(mid.contains("enemyWeightedCoverageScore="), "partial enemy CURRENT 不得输出 enemy 分数: " + mid);
    }











    @Test
    void completeEnemyCurrentStillProducesGeometricTerciles() {
        final String section = FormationDepthEvidence.renderSection(battle(), reconWithPositions(20f), 1, MAP);
        assertTrue(section.contains("GEOMETRIC_FORWARD=account:1001"), section);
        assertTrue(section.contains("GEOMETRIC_REAR=account:1002"), section);
        assertTrue(section.contains("coverageCompleteness=ownRef=2/2 enemyRef=2/2"), section);
        assertTrue(section.contains("ownWeightedCoverageScore="), section);
        assertTrue(section.contains("enemyWeightedCoverageScore="), section);
        assertFalse(section.contains("POSITION_COVERAGE_INSUFFICIENT"),
                "双方 CURRENT 完整时不得 fail-close: " + section);
    }

    }
