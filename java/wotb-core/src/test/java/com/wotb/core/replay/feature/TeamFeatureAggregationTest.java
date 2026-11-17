package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.processing.TeamPerspectiveResolution;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;


class TeamFeatureAggregationTest extends DefaultTeamBattleFeatureFixture {
    @Test
    void extractsOnlyPerspectiveTeamAndKeepsMemberMovementsSeparate() {
        final Fixture fixture = fixture();

        final TeamBattleFeatureSet features = extract(fixture, fixture.events());

        assertEquals(2, features.members().size());
        assertTrue(features.members().stream().allMatch(member -> member.team() == 1));
        assertTrue(features.members().stream()
                .flatMap(member -> member.movements().stream())
                .allMatch(movement -> movement.distance() < 100));
        assertTrue(features.members().stream()
                .flatMap(member -> member.movements().stream())
                .noneMatch(movement -> movement.rawStartPosition().x() >= 900
                        || movement.rawEndPosition().x() >= 900));
    }
    @Test
    void attributesTeamDamageAndLeavesUnknownEventsUnattributed() {
        final Fixture fixture = fixture();

        final TeamBattleFeatureSet features = extract(fixture, fixture.events());

        assertEquals(200, features.observedAggregate().damageDealt());
        assertEquals(550, features.observedAggregate().damageReceived());
        assertEquals(2, features.observedAggregate().attributedDamageEventCount());
        assertEquals(1, features.observedAggregate().unattributedDamageEventCount());
        assertTrue(features.limitations().contains(
                "UNATTRIBUTED_DAMAGE_EVENTS_PRESENT"));
    }
    @Test
    void authoritativeResultsRemainUsableWithEmptyEventStream() {
        final Fixture fixture = fixture();
        final TeamBattleFeatureSet features = extract(fixture, List.of());

        assertTrue(features.hasFeatures());
        assertFalse(features.coverage().fullFeaturesAvailable());
        assertEquals(700, features.authoritativeAggregate().totalDamageDealt());
        assertTrue(features.limitations().contains("POSITION_FORMATION_UNAVAILABLE"));
    }
    @Test
    void authoritativeResultsRemainUsableWithoutDamageEvents() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> withoutDamage = fixture.events().stream()
                .filter(event -> !(event instanceof DamageEvent))
                .toList();

        final TeamBattleFeatureSet features = extract(fixture, withoutDamage);

        assertTrue(features.hasFeatures());
        assertEquals(0, features.observedAggregate().damageDealt());
        assertEquals(700, features.authoritativeAggregate().totalDamageDealt());
    }
    @Test
    void authoritativeDeathCreatesStableKeyEvent() {
        final Fixture fixture = fixture();
        final TeamBattleFeatureSet features = extract(fixture, fixture.events());

        assertTrue(features.keyEvents().stream()
                .anyMatch(event -> "TEAM_MEMBER_DESTROYED".equals(event.type())
                        && event.confidence() == DecodeConfidence.EXACT
                        && "BATTLE_RESULTS".equals(event.source())));
    }
    @Test
    void separatedMembersProduceMultipleFormationClusters() {
        final Fixture fixture = fixture();
        final TeamBattleFeatureSet features = extract(fixture, fixture.events());

        assertTrue(features.formationPhases().stream()
                .anyMatch(phase -> phase.clusterCount() == 2));
        assertTrue(features.keyEvents().stream()
                .anyMatch(event -> "TEAM_FORMATION_SPLIT".equals(event.type())));
    }
    @Test
    void eventOrderDoesNotChangeAggregatesOrFormation() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> reversed = new ArrayList<>(fixture.events());
        Collections.reverse(reversed);

        final TeamBattleFeatureSet ordered = extract(fixture, fixture.events());
        final TeamBattleFeatureSet shuffled = extract(fixture, reversed);

        assertEquals(ordered.observedAggregate(), shuffled.observedAggregate());
        assertEquals(ordered.formationPhases(), shuffled.formationPhases());
        assertEquals(ordered.keyEvents(), shuffled.keyEvents());
    }
    @Test
    void coverageDistinguishesAuthoritativeAndObservedSources() {
        final Fixture fixture = fixture();
        final TeamBattleFeatureSet features = extract(fixture, fixture.events());

        assertTrue(features.coverage().authoritativeSummaryAvailable());
        assertTrue(features.coverage().reconstructionAvailable());
        assertEquals(2, features.coverage().authoritativeMemberCount());
        assertEquals(2, features.coverage().mappedMemberCount());
        assertTrue(features.limitations().contains("OBSERVED_DAMAGE_IS_PARTIAL"));
    }
    @Test
    void observedDamageMatchingAuthoritativeOmitsPartialLimitation() {
        final PlayerResult allyOne = player(100L, "AllyOne", 1, 400, 100, true, 0);
        final PlayerResult allyTwo = player(101L, "AllyTwo", 1, 300, 200, true, 0);
        final PlayerResult enemy = player(200L, "Enemy", 2, 600, 300, false, 30_000);
        final Battle battle = new Battle();
        battle.arenaId = "arena-team";
        battle.arenaBonusType = 2;
        battle.mapName = "test-map";
        battle.durationS = 120.0;
        battle.winnerTeam = 1;
        battle.recorder = "AllyOne";
        battle.players = List.of(allyOne, allyTwo, enemy);
        final List<BattleParticipant> participants = List.of(
                new BattleParticipant(100L, "AllyOne", 1, 1, "a", true),
                new BattleParticipant(101L, "AllyTwo", 1, 2, "b", false),
                new BattleParticipant(200L, "Enemy", 2, 3, "c", false));
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 11, 101L),
                mapping(3, 20, 200L),
                position(4, 5f, 10, 0f, 0f),
                position(5, 8f, 10, 2.5f, 0f),
                position(6, 5f, 11, 125f, 0f),
                position(7, 8f, 11, 127.5f, 0f),
                position(8, 5f, 20, 250f, 250f),
                damage(9, 20f, 10, 20, 400),
                damage(10, 25f, 11, 20, 300),
                damage(11, 30f, 20, 10, 100),
                damage(12, 35f, 20, 11, 200),
                health(13, 19f, 20, 900), health(14, 20f, 20, 500),
                health(15, 24f, 20, 500), health(16, 25f, 20, 200),
                health(17, 29f, 10, 900), health(18, 30f, 10, 800),
                health(19, 34f, 11, 900), health(20, 35f, 11, 700));
        final TeamBattleFeatureSet features = extract(
                new Fixture(battle, participants, events), events);

        assertEquals(700, features.observedAggregate().damageDealt(),
                "observed=" + features.observedAggregate()
                        + " limitations=" + features.limitations());
        assertEquals(300, features.observedAggregate().damageReceived(),
                "observed=" + features.observedAggregate()
                        + " limitations=" + features.limitations());
        assertFalse(features.limitations().contains("OBSERVED_DAMAGE_IS_PARTIAL"),
                "观测=权威时不得标记 PARTIAL：" + features.limitations());
    }
    @Test
    void friendlyFireDoesNotCreateEnemyEngagement() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = new ArrayList<>(fixture.events());
        events.add(damage(12, 35f, 10, 11, 75));

        final TeamBattleFeatureSet features = extract(fixture, events);
        final TeamMemberFeatureSet ally = features.members().stream()
                .filter(member -> member.accountId() == 100L)
                .findFirst()
                .orElseThrow();

        assertEquals(200, features.observedAggregate().damageDealt());
        assertTrue(ally.engagements().stream()
                .flatMap(engagement -> engagement.enemyAccountIds().stream())
                .noneMatch(accountId -> accountId == 101L));
    }
    @Test
    void mappingConflictWithoutDamageIsNotCountedAsUnattributedEvent() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 10, 200L));

        final TeamBattleFeatureSet features = extract(fixture, events);

        assertEquals(0, features.observedAggregate().unattributedDamageEventCount());
        assertTrue(features.limitations().contains("TEAM_ENTITY_MAPPING_CONFLICT"));
        assertFalse(features.limitations().contains(
                "UNATTRIBUTED_DAMAGE_EVENTS_PRESENT"));
    }
    @Test
    void nicknameFallbackFeedsTheAuthoritativeMembersTimeline() {
        final Fixture fixture = fixture();
        final List<BattleParticipant> participants = List.of(
                new BattleParticipant(100L, "AllyOne", 1, 1, "a", true),
                new BattleParticipant(999L, "AllyTwo", 1, 2, "b", false),
                new BattleParticipant(200L, "Enemy", 2, 3, "c", false));
        final List<ReplayEvent> events = fixture.events().stream()
                .map(event -> event instanceof ParticipantMappingEvent participantMapping
                        && participantMapping.accountId() == 101L
                        ? mapping(
                                participantMapping.sequence(),
                                participantMapping.entityId(),
                                999L)
                        : event)
                .toList();
        final Fixture fallbackFixture =
                new Fixture(fixture.battle(), participants, events);

        final TeamBattleFeatureSet features = extract(fallbackFixture, events);
        final TeamMemberFeatureSet allyTwo = features.members().stream()
                .filter(member -> member.accountId() == 101L)
                .findFirst()
                .orElseThrow();

        assertEquals(List.of(11), allyTwo.entityIds());
        assertEquals(DecodeConfidence.INFERRED, allyTwo.mappingConfidence());
        assertFalse(allyTwo.movements().isEmpty());
    }
    @Test
    void reconstructedFeaturesRemainUsableWithoutAuthoritativeRoster() {
        final Battle battle = new Battle();
        battle.mapName = "reconstructed-only";
        final List<BattleParticipant> participants = List.of(
                new BattleParticipant(100L, "Ally", 1, 1, "a", true),
                new BattleParticipant(200L, "Enemy", 2, 2, "b", false));
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 20, 200L),
                position(3, 5f, 10, 0f, 0f),
                position(4, 8f, 10, 10f, 0f),
                damage(5, 20f, 10, 20, 100),
                health(6, 19f, 20, 500), health(7, 20f, 20, 400));
        final ReplayReconstruction reconstruction = new ReplayReconstruction(
                null, null, 60f, 0f, participants, events,
                List.of(), null,
                new ReplayCoverage(events.size(), events.size(),
                        0, 0, 0, 1.0, Map.of()),
                null);
        final TeamPerspectiveResolution perspective =
                new TeamPerspectiveResolution(
                        1, 100L, 10, DecodeConfidence.EXACT, List.of());

        final TeamBattleFeatureSet features =
                extractor.extract(battle, reconstruction, perspective);

        assertTrue(features.hasFeatures());
        assertNull(features.authoritativeAggregate());
        assertEquals(1, features.coverage().mappedMemberCount());
        assertEquals(100, features.observedAggregate().damageDealt());
    }
    @Test
    void engagementGapUsesTenSecondsAsAnInclusiveBoundary() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 11, 101L),
                mapping(3, 20, 200L),
                damage(4, 20f, 10, 20, 100),
                damage(5, 30f, 20, 10, 100),
                damage(6, 40.1f, 10, 20, 10));

        final TeamBattleFeatureSet features = extract(fixture, events);

        assertEquals(2, features.engagements().size());
        assertEquals(20f, features.engagements().getFirst().startTime());
        assertEquals(30f, features.engagements().getFirst().endTime());
    }
    @Test
    void formationClusteringUsesOneHundredMetersAsAnInclusiveBoundary() {
        final Fixture fixture = fixture();

        assertEquals(1, formationClusters(fixture, 100f));
        assertEquals(2, formationClusters(fixture, 100.1f));
    }
    @Test
    void clampedPositionsUseCanonicalDistance() {
        // raw X1=255 (clamped to 250, cx=500), raw X2=200 (cx=450) → canonical distance 50m → same cluster
        final Fixture fixture = fixture();
        assertEquals(1, formationClusters(fixture, 255f, 200f));
        // raw X1=255 (clamped to 250, cx=500), raw X2=100 (cx=350) → canonical distance 150m → separate cluster
        assertEquals(2, formationClusters(fixture, 255f, 100f));
    }
    @Test
    void focusFireUsesAnIndependentFiveSecondInclusiveWindow() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> inclusive = List.of(
                mapping(1, 10, 100L),
                mapping(2, 11, 101L),
                mapping(3, 20, 200L),
                damage(4, 20f, 10, 20, 100),
                damage(5, 25f, 11, 20, 100));
        final List<ReplayEvent> outside = List.of(
                mapping(1, 10, 100L),
                mapping(2, 11, 101L),
                mapping(3, 20, 200L),
                damage(4, 20f, 10, 20, 100),
                damage(5, 25.1f, 11, 20, 100));

        assertEquals(
                List.of(200L),
                extract(fixture, inclusive)
                        .engagements().getFirst().focusedTargetAccountIds());
        assertTrue(extract(fixture, outside)
                .engagements().getFirst().focusedTargetAccountIds().isEmpty());
    }
    @Test
    void targetSwitchesAreCountedFromOrderedOutgoingDamage() {
        final Fixture fixture = fixtureWithSecondEnemy();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 20, 200L),
                mapping(3, 21, 201L),
                damage(4, 20f, 10, 20, 100),
                damage(5, 21f, 10, 21, 100),
                damage(6, 22f, 10, 20, 100));

        final TeamEngagementSummary engagement =
                extract(fixture, events).engagements().getFirst();

        assertEquals(2, engagement.targetSwitchCount());
    }
    @Test
    void outOfBoundsPositionsAreIgnoredAndReported() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                position(2, 5f, 10, 125f, 0f),
                position(3, 6f, 10, 375f, 0f));

        final TeamBattleFeatureSet features = extract(fixture, events);

        assertEquals(1, features.coverage().observedPositionEventCount());
        assertEquals(1, features.coverage().ignoredOutOfBoundsPositionEventCount());
        assertTrue(features.limitations().contains(
                "OUT_OF_BOUNDS_POSITION_EVENTS_IGNORED"));
    }
    @Test
    void elevationUsesTwoHundredMetersAsAnInclusiveBoundary() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                positionWithElevation(2, 5f, 10, 200f),
                positionWithElevation(3, 6f, 10, 200.1f));

        final TeamFeatureCoverage coverage = extract(fixture, events).coverage();

        assertEquals(1, coverage.observedPositionEventCount());
        assertEquals(1, coverage.ignoredOutOfBoundsPositionEventCount());
    }
}



