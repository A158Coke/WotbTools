package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import org.junit.jupiter.api.Test;
import java.util.ArrayList;
import java.util.List;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;


class TeamFeaturePositionCoverageTest extends DefaultTeamBattleFeatureFixture {
    @Test
    void invalidEventTimestampsAreIgnoredAndReported() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 20, 200L),
                position(3, Float.NaN, 10, 0f, 0f),
                damage(4, Float.POSITIVE_INFINITY, 10, 20, 100));

        final TeamBattleFeatureSet features = extract(fixture, events);

        assertEquals(0, features.coverage().observedPositionEventCount());
        assertEquals(0, features.coverage().observedDamageEventCount());
        assertEquals(2, features.coverage().ignoredInvalidTimestampEventCount());
        assertEquals(0, features.coverage().unattributedDamageEventCount());
        assertTrue(features.limitations().contains(
                "INVALID_EVENT_TIMESTAMPS_IGNORED"));
    }
    @Test
    void unmappedPositionsAreCountedAsNonCombatantNotTactical() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                position(2, 5f, 99, 0f, 0f));

        final TeamBattleFeatureSet features = extract(fixture, events);

        assertEquals(1, features.coverage().nonCombatantPositionEventCount());
        assertEquals(0, features.coverage().unattributedPositionEventCount());
        assertFalse(features.limitations().contains(
                "UNATTRIBUTED_POSITION_EVENTS_PRESENT"));
    }
    @Test
    void spectatorEntityDoesNotCreateTeamPositionLimitations() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 11, 101L),
                mapping(3, 20, 200L),
                mapping(4, 30, 300L),
                position(5, 5f, 10, 0f, 0f),
                position(6, 5f, 11, 125f, 0f),
                position(7, 5f, 20, 250f, 250f),
                position(8, 1f, 30, 10f, 10f));

        final TeamBattleFeatureSet features = extract(fixture, events);

        assertEquals(1, features.coverage().nonCombatantPositionEventCount());
        assertEquals(0, features.coverage().unattributedPositionEventCount());
        assertFalse(features.limitations().contains(
                "UNATTRIBUTED_POSITION_EVENTS_PRESENT"));
        assertTrue(features.members().stream()
                .allMatch(member -> !member.limitations().contains(
                        "TEAM_MEMBER_ENTITY_UNMAPPED")
                        && !member.limitations().contains("TEAM_MEMBER_POSITION_UNAVAILABLE")));
    }
    @Test
    void actualCombatantEntityUnattributableStillRaisesLimitation() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 10, 200L),
                position(3, 5f, 10, 0f, 0f));

        final TeamBattleFeatureSet features = extract(fixture, events);

        assertEquals(1, features.coverage().unattributedPositionEventCount());
        assertTrue(features.limitations().contains(
                "UNATTRIBUTED_POSITION_EVENTS_PRESENT"));
        assertTrue(features.limitations().contains("TEAM_ENTITY_MAPPING_CONFLICT"));
    }
    @Test
    void actualCombatantWithoutEntityMappingRaisesUnmappedLimitation() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                position(2, 5f, 10, 0f, 0f));

        final TeamBattleFeatureSet features = extract(fixture, events);
        final TeamMemberFeatureSet allyTwo = features.members().stream()
                .filter(member -> member.accountId() == 101L)
                .findFirst().orElseThrow();

        assertTrue(allyTwo.limitations().contains("TEAM_MEMBER_ENTITY_UNMAPPED"));
        assertTrue(allyTwo.entityIds().isEmpty());
        assertFalse(allyTwo.limitations().contains("TEAM_MEMBER_POSITION_UNAVAILABLE"),
                "完全 unmapped 成员不得同时产生 TEAM_MEMBER_POSITION_UNAVAILABLE: " + allyTwo.limitations());
    }
    @Test
    void mappedCombatantWithoutUsablePositionRaisesPositionUnavailable() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 11, 101L));

        final TeamBattleFeatureSet features = extract(fixture, events);
        final TeamMemberFeatureSet allyTwo = features.members().stream()
                .filter(member -> member.accountId() == 101L)
                .findFirst().orElseThrow();

        assertTrue(allyTwo.limitations().contains("TEAM_MEMBER_POSITION_UNAVAILABLE"));
        assertFalse(allyTwo.limitations().contains("TEAM_MEMBER_ENTITY_UNMAPPED"));
    }
    @Test
    void nicknameMappedCombatantEntityStillRaisesLimitation() {
        final PlayerResult allyOneA = player(100L, "AllyOne", 1, 400, 100, true, 0);
        final PlayerResult allyOneB = player(105L, "AllyOne", 1, 400, 100, true, 0);
        final PlayerResult enemy = player(200L, "Enemy", 2, 600, 300, true, 0);
        final Battle battle = new Battle();
        battle.arenaId = "arena-team";
        battle.arenaBonusType = 2;
        battle.mapName = "test-map";
        battle.durationS = 120.0;
        battle.winnerTeam = 1;
        battle.recorder = "Enemy";
        battle.players = List.of(allyOneA, allyOneB, enemy);
        final List<BattleParticipant> participants = List.of(
                new BattleParticipant(100L, "AllyOne", 1, 1, "a", false),
                new BattleParticipant(105L, "AllyOne", 1, 2, "b", false),
                new BattleParticipant(200L, "Enemy", 2, 3, "c", true));
        final List<ReplayEvent> events = List.of(
                new ParticipantMappingEvent(1, new ReplayTimestamp(0f, null), 8,
                        DecodeConfidence.EXACT, 10, 0L, "AllyOne", 1),
                position(2, 5f, 10, 0f, 0f));

        final TeamBattleFeatureSet features = extract(new Fixture(battle, participants, events), events);

        assertEquals(1, features.coverage().unattributedPositionEventCount());
        assertEquals(0, features.coverage().nonCombatantPositionEventCount());
        assertTrue(features.limitations().contains("UNATTRIBUTED_POSITION_EVENTS_PRESENT"));
    }
    @Test
    void coverageToStringDoesNotLeakNonCombatantCounter() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 30, 300L),
                position(3, 5f, 30, 0f, 0f));
        final TeamFeatureCoverage coverage = extract(fixture, events).coverage();

        assertEquals(1, coverage.nonCombatantPositionEventCount());
        assertFalse(coverage.toString().contains("nonCombatantPositionEventCount"),
                "AI-visible coverage 渲染不得泄露 non-combatant 计数: " + coverage);
        assertFalse(coverage.toString().contains("nonCombatant"),
                "AI-visible coverage 渲染不得泄露 non-combatant 字样: " + coverage);
    }
    @Test
    void partialPositionsLowerMovementConfidence() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                position(2, 5f, 10, 0f, 0f, DecodeConfidence.EXACT),
                position(3, 8f, 10, 10f, 0f, DecodeConfidence.PARTIAL));

        final TeamMemberFeatureSet member = extract(fixture, events).members().stream()
                .filter(candidate -> candidate.accountId() == 100L)
                .findFirst()
                .orElseThrow();

        assertEquals(
                DecodeConfidence.PARTIAL,
                member.movements().getFirst().confidence());
    }
    @Test
    void unknownWinnerAndBattleEndRemainUnknown() {
        final Fixture fixture = fixture();
        fixture.battle().winnerTeam = null;
        fixture.battle().durationS = null;

        final TeamBattleFeatureSet features = extract(
                fixture, List.of(mapping(1, 10, 100L)));

        assertNull(features.authoritativeAggregate().win());
        assertTrue(features.keyEvents().stream()
                .noneMatch(event -> "BATTLE_END".equals(event.type())));
    }
    @Test
    void supremacyMissingWinner_neitherTeamWiped_pointsLeadFailsClosed() {
        final Fixture fixture = fixture();
        fixture.battle().winnerTeam = null;
        fixture.battle().players.get(0).victoryPointsEarned = 400;
        fixture.battle().players.get(2).victoryPointsEarned = 100;

        final TeamBattleFeatureSet features = extract(fixture, List.of());

        assertEquals(null, features.authoritativeAggregate().win());
    }
    @Test
    void supremacyMissingWinner_enemyWiped_friendlyWinsBySettlement() {
        final Fixture fixture = fixture();
        fixture.battle().winnerTeam = null;
        fixture.battle().players.get(2).survived = false;

        final TeamBattleFeatureSet features = extract(fixture, List.of());

        assertEquals(Boolean.TRUE, features.authoritativeAggregate().win());
    }
    @Test
    void inBattleValidPositionIsObservedNotClamped() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                position(2, 5f, 10, 125f, 0f));

        final TeamFeatureCoverage coverage = extract(fixture, events).coverage();

        assertEquals(1, coverage.observedPositionEventCount());
        assertEquals(0, coverage.clampedPositionEventCount());
    }
    @Test
    void enemyPositionNotInPerspectiveCoverage() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 20, 200L),
                position(2, 5f, 20, 500f, 0f));

        final TeamFeatureCoverage coverage = extract(fixture, events).coverage();

        assertEquals(0, coverage.observedPositionEventCount());
        assertEquals(0, coverage.clampedPositionEventCount());
        assertEquals(0, coverage.unattributedPositionEventCount());
        assertTrue(coverage.clampedPositionEventCount() <= coverage.observedPositionEventCount());
    }
    @Test
    void clusterCentroidAveragesCanonicalNotRaw() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 11, 101L),
                position(3, 5f, 10, 255f, 0f),
                position(4, 5f, 11, 162.475f, 0f));

        final TeamFormationCluster cluster = extract(fixture, events)
                .formationPhases()
                .getFirst()
                .clusters()
                .getFirst();

        assertEquals(456.2375f, cluster.centroidX(), 0.01f);
        assertEquals(250f, cluster.centroidZ(), 0.01f);
        assertEquals(2, cluster.memberCount());
        assertEquals(cluster.memberCount(), cluster.memberIdentities().size());
        assertEquals(6, cluster.region());
        assertEquals(1, cluster.clampedMemberPositionCount());
        assertEquals(MapCoordinateResolution.Status.CLAMPED, cluster.centroidStatus());
    }
    @Test
    void teamEnemyOnlyDamageDoesNotSetPhaseEnd() {
        final Fixture fixture = fixture();
        fixture.battle().durationS = null;
        final List<BattleParticipant> participants = new ArrayList<>(fixture.participants());
        participants.add(new BattleParticipant(202L, "EnemyTwo", 2, 99, "e", false));
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                position(2, 90f, 10, 0f, 0f),
                damage(3, 150f, 20, 99, 200));
        final TeamBattleFeatureSet features = extract(
                new Fixture(fixture.battle(), participants, events), events);
        assertFalse(features.battlePhases().isEmpty());
        assertTrue(features.battlePhases().stream()
                .noneMatch(phase -> phase.endTime() >= 150f));
        assertTrue(features.battlePhases().stream()
                .anyMatch(phase -> Math.abs(phase.endTime() - 90f) < 0.01f));
    }
    @Test
    void teamUnresolvedBattleEndHasLimitation() {
        final Fixture fixture = fixture();
        fixture.battle().durationS = null;
        final TeamBattleFeatureSet features = extract(fixture, List.of());
        assertTrue(features.limitations().contains("BATTLE_END_UNRESOLVED"));
        assertTrue(features.battlePhases().isEmpty());
    }
    @Test
    void teamMemberMovementUsesCanonicalMeters() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                position(2, 10f, 10, 0f, 0f),
                position(3, 15f, 10, 100f, 0f));

        final TeamMemberFeatureSet member = extract(fixture, events).members().stream()
                .filter(candidate -> candidate.accountId() == 100L)
                .findFirst()
                .orElseThrow();

        final MovementSegment movement = member.movements().getFirst();
        assertEquals(100f, movement.distance(), 0.01f);
        assertEquals(20f, movement.averageSpeed(), 0.01f);
    }
}



