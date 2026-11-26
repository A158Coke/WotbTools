package com.wotb.ai.review;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.HealthChangedEvent;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;
import java.util.ArrayList;
import java.util.List;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RelativeDepthHpEvidenceGeometryTest extends RelativeDepthHpEvidenceTestSupport {
    @Test
    void lightTankNearestIsGeometricReference() {
        final Battle battle = new Battle();
        battle.mapName = MAP;
        battle.durationS = 100d;
        battle.players = List.of(
                player(1001L, 1, E100),
                player(1002L, 1, VICKERS_LIGHT),
                player(2001L, 2, FV215B183),
                player(2002L, 2, FV215B183));
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -220f, 0f));
        events.add(pos(12, 40f, 11, -60f, 0f));
        events.add(pos(20, 40f, 20, 200f, 0f));
        events.add(pos(21, 40f, 21, 230f, 50f));
        events.add(pos(22, 120f, 20, 200f, 0f));
        events.add(pos(23, 120f, 21, 230f, 50f));
        events.add(hp(30, 30f, 10, 1800));
        events.add(hp(31, 30f, 11, 400));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle, recon, 1, false);
        assertTrue(section.contains("vs reference account:1002"), "LT 应作为纯几何 reference: " + section);
        assertTrue(section.contains("LIGHT"), "reference 行必须带 LT 静态 profile 事实");
        assertFalse(section.contains("扛线队友"), "不得把 reference 命名为战术角色");
    }

    @Test
    void paperTdNearestIsGeometricReference() {
        final Battle battle = new Battle();
        battle.mapName = MAP;
        battle.durationS = 100d;
        battle.players = List.of(
                player(1001L, 1, E100),
                player(1002L, 1, FV215B183),
                player(2001L, 2, FV215B183),
                player(2002L, 2, FV215B183));
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -220f, 0f));
        events.add(pos(12, 40f, 11, -60f, 0f));
        events.add(pos(20, 40f, 20, 200f, 0f));
        events.add(pos(21, 40f, 21, 230f, 50f));
        events.add(pos(22, 120f, 20, 200f, 0f));
        events.add(pos(23, 120f, 21, 230f, 50f));
        events.add(hp(30, 30f, 10, 1800));
        events.add(hp(31, 30f, 11, 400));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle, recon, 1, false);
        assertTrue(section.contains("vs reference account:1002"), "纸 TD 应作为纯几何 reference: " + section);
        assertFalse(section.contains("扛线队友"), section);
    }

    @Test
    void referenceSelectedByPureGeometry() {
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon(true, true), 1, false);
        assertTrue(section.contains("vs reference account:1002"), "几何 reference 应为 1002, got: " + section);
        assertTrue(section.contains("observedAttackEvents=2"), section);
        assertFalse(section.contains("利用队友输出"), section);
    }

    @Test
    void noReferenceYieldsNoMeasurement() {
        final Battle battle = new Battle();
        battle.mapName = MAP;
        battle.durationS = 100d;
        battle.players = List.of(
                player(1001L, 1, E100),
                player(1002L, 1, VICKERS_LIGHT),
                player(2001L, 2, FV215B183),
                player(2002L, 2, FV215B183));
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -220f, 0f));
        events.add(pos(20, 40f, 20, 200f, 0f));
        events.add(pos(21, 40f, 21, 230f, 50f));
        events.add(hp(30, 30f, 10, 1800));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle, recon, 1, false);
        assertFalse(section.contains("vs reference"), "无 reference 不得产生测量行, got: " + section);
    }

    @Test
    void deadMemberCannotBeReference() {
        final Battle battle = battle(E100, E100);
        for (final PlayerResult pl : battle.players) {
            if (pl.accountId == 1002L) {
                pl.survived = false;
                pl.deathTimeMillis = 10_000L;
        pl.settlementLifeTimeSec = 10;
            }
        }
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle, recon(true, true), 1, false);
        assertFalse(section.contains("vs reference account:1002"), "已阵亡 HEAVY 不得成为 reference, got: " + section);
    }

    @Test
    void enemyPositionReferenceIncompleteYieldsNoMeasurements() {
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -220f, 0f));
        events.add(pos(12, 40f, 11, -90f, 0f));
        events.add(pos(20, 40f, 20, 200f, 0f));
        events.add(pos(22, 120f, 20, 200f, 0f));
        events.add(hp(30, 30f, 10, 1800));
        events.add(hp(31, 30f, 11, 1000));
        events.add(dmg(40, 50f, 10, 20));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon, 1, false);
        assertFalse(section.contains("vs reference"), "敌方位置参考不完整时不得产生测量, got: " + section);
    }

    @Test
    void enemyPositionsCompletelyMissingYieldsNoVerdict() {
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -220f, 0f));
        events.add(pos(12, 40f, 11, -90f, 0f));
        events.add(hp(30, 30f, 10, 1800));
        events.add(hp(31, 30f, 11, 1000));
        events.add(dmg(40, 50f, 10, 20));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon, 1, false);
        assertTrue(section.isEmpty() || !section.contains("vs reference"),
                "敌方完全无位置时不得输出测量, got: " + section);
    }

    @Test
    void nullAndSentinelHpEventsAreSkippedWithoutException() {
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -220f, 0f));
        events.add(pos(12, 40f, 11, -90f, 0f));
        events.add(pos(20, 40f, 20, 200f, 0f));
        events.add(pos(21, 40f, 21, 230f, 50f));
        events.add(pos(22, 120f, 20, 200f, 0f));
        events.add(pos(23, 120f, 21, 230f, 50f));
        events.add(hp(30, 30f, 10, 1800));
        events.add(hp(31, 30f, 11, 1000));
        events.add(new HealthChangedEvent(32, new ReplayTimestamp(35f, null), 7,
                DecodeConfidence.EXACT, 10, null, null, null));
        events.add(new HealthChangedEvent(33, new ReplayTimestamp(36f, null), 7,
                DecodeConfidence.EXACT, 10, 65533, null, true));
        events.add(new HealthChangedEvent(34, new ReplayTimestamp(37f, null), 7,
                DecodeConfidence.EXACT, 10, 65535, null, true));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon, 1, false);
        assertTrue(section.contains("vs reference account:1002"),
                "正常正 HP 判定不得被 null/sentinel 破坏, got: " + section);
    }

    @Test
    void zeroHpAllowedAsDeathTerminalWithoutException() {
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -220f, 0f));
        events.add(pos(12, 40f, 11, -90f, 0f));
        events.add(pos(20, 40f, 20, 200f, 0f));
        events.add(pos(21, 40f, 21, 230f, 50f));
        events.add(pos(22, 120f, 20, 200f, 0f));
        events.add(pos(23, 120f, 21, 230f, 50f));
        events.add(hp(30, 30f, 10, 1800));
        events.add(hp(31, 30f, 11, 1000));
        events.add(hp(32, 50f, 10, 0));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon, 1, false);
        assertFalse(section.contains("利用队友输出"), "0 死亡终态后不得再判吸血/避战");
    }

    @Test
    void openingRearTercileIsPureGeometryForAllMembers() {
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -220f, 0f));
        events.add(pos(12, 40f, 11, -90f, 0f));
        events.add(pos(20, 40f, 20, 200f, 0f));
        events.add(pos(21, 40f, 21, 230f, 50f));
        events.add(pos(22, 120f, 20, 200f, 0f));
        events.add(pos(23, 120f, 21, 230f, 50f));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(FV215B183, E100), recon, 1, false);
        assertTrue(section.contains("account:1001"), "TD 靠后也应输出 opening 几何事实: " + section);
        assertTrue(section.contains("最靠后三分位"), section);
        assertTrue(section.contains("TANK_DESTROYER"), "必须附 TD 静态 profile 事实");
        assertFalse(section.contains("未上前线"), "不得输出「未上前线」战术判定");
        assertFalse(section.contains("frontlineCapable"), section);
    }

    @Test
    void staleEnemyDoesNotProduceExactRelativeDepthDistance() {
        final List<ReplayEvent> events = new ArrayList<>();
        events.add(new ParticipantMappingEvent(1, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 10, 1001L));
        events.add(new ParticipantMappingEvent(2, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 11, 1002L));
        events.add(new ParticipantMappingEvent(3, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 20, 2001L));
        events.add(new ParticipantMappingEvent(4, new ReplayTimestamp(20f, null), 8,
                DecodeConfidence.EXACT, 21, 2002L));
        events.add(pos(10, 40f, 10, -220f, 0f));
        events.add(pos(12, 40f, 11, -90f, 0f));
        events.add(pos(20, 30f, 20, 200f, 0f));
        events.add(pos(21, 30f, 21, 230f, 50f));
        events.add(new com.wotb.core.replay.event.EntityRemovedEvent(55, new ReplayTimestamp(40f, null), 4,
                DecodeConfidence.EXACT, 20));
        events.add(new com.wotb.core.replay.event.EntityRemovedEvent(56, new ReplayTimestamp(40f, null), 4,
                DecodeConfidence.EXACT, 21));
        events.add(hp(30, 30f, 10, 1800));
        events.add(hp(31, 30f, 11, 1000));
        events.add(dmg(40, 50f, 10, 20));
        final ReplayReconstruction recon = new ReplayReconstruction(null, null, 100f, 20f, List.of(),
                events, List.of(), null, null, null);
        final String section = RelativeDepthHpEvidence.renderTeamSection(
                battle(E100, E100), recon, 1, false);
        assertTrue(section.isEmpty(), "stale enemy 不得产生 exact RelativeDepth 测量，got: " + section);
        assertFalse(section.contains("memberDist="), "不得输出 memberDist: " + section);
        assertFalse(section.contains("referenceDist="), "不得输出 referenceDist: " + section);
        assertFalse(section.contains("relativeDepthM="), "不得输出 relativeDepthM: " + section);
        assertFalse(section.contains("vs reference"), "不得输出 reference 测量行: " + section);
    }
}
