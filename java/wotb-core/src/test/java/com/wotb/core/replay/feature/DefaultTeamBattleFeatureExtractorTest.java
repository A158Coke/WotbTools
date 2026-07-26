package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.processing.TeamPerspectiveResolution;
import com.wotb.core.processing.TeamPerspectiveResolver;
import com.wotb.core.replay.event.BattleEndedEvent;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
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

class DefaultTeamBattleFeatureExtractorTest {

    private final DefaultTeamBattleFeatureExtractor extractor =
            new DefaultTeamBattleFeatureExtractor();

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
                .noneMatch(movement -> movement.startPosition().x() >= 900
                        || movement.endPosition().x() >= 900));
    }

    @Test
    void attributesTeamDamageAndLeavesUnknownEventsUnattributed() {
        final Fixture fixture = fixture();

        final TeamBattleFeatureSet features = extract(fixture, fixture.events());

        assertEquals(200, features.observedAggregate().damageDealt());
        assertEquals(150, features.observedAggregate().damageReceived());
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
                damage(5, 20f, 10, 20, 100));
        final ReplayReconstruction reconstruction = new ReplayReconstruction(
                null, null, 60f, null, participants, events,
                List.of(), null,
                new ReplayCoverage(true, events.size(), events.size(),
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
    void engagementOutcomeUsesOnePointTwoFiveAsAnExclusiveBoundary() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> evenEvents = List.of(
                mapping(1, 10, 100L),
                mapping(2, 20, 200L),
                damage(3, 20f, 10, 20, 125),
                damage(4, 25f, 20, 10, 100));
        final List<ReplayEvent> favorableEvents = List.of(
                mapping(1, 10, 100L),
                mapping(2, 20, 200L),
                damage(3, 20f, 10, 20, 126),
                damage(4, 25f, 20, 10, 100));

        assertEquals(
                EngagementOutcome.EVEN,
                extract(fixture, evenEvents).engagements().getFirst().outcome());
        assertEquals(
                EngagementOutcome.FAVORABLE,
                extract(fixture, favorableEvents).engagements().getFirst().outcome());
    }

    @Test
    void formationClusteringUsesOneHundredMetersAsAnInclusiveBoundary() {
        final Fixture fixture = fixture();

        assertEquals(1, formationClusters(fixture, 400f));
        assertEquals(2, formationClusters(fixture, 400.1f));
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
                position(2, 5f, 10, 500f, 0f),
                position(3, 6f, 10, 1500f, 0f));

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
        assertEquals(1, features.coverage().unattributedDamageEventCount());
        assertTrue(features.limitations().contains(
                "INVALID_EVENT_TIMESTAMPS_IGNORED"));
    }

    @Test
    void unmappedPositionsHaveAnExplicitCoverageCount() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                position(2, 5f, 99, 0f, 0f));

        final TeamBattleFeatureSet features = extract(fixture, events);

        assertEquals(1, features.coverage().unattributedPositionEventCount());
        assertTrue(features.limitations().contains(
                "UNATTRIBUTED_POSITION_EVENTS_PRESENT"));
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
    void replayBattleEndKeepsItsSourceAndConfidence() {
        final Fixture fixture = fixture();
        fixture.battle().durationS = null;
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                new BattleEndedEvent(
                        2, new ReplayTimestamp(90f, null), 14,
                        DecodeConfidence.INFERRED, 1));

        final KeyBattleEvent battleEnd = extract(fixture, events).keyEvents().stream()
                .filter(event -> "BATTLE_END".equals(event.type()))
                .findFirst()
                .orElseThrow();

        assertEquals(90f, battleEnd.clockSec());
        assertEquals("REPLAY_EVENT", battleEnd.source());
        assertEquals(DecodeConfidence.INFERRED, battleEnd.confidence());
    }

    private int formationClusters(final Fixture fixture, final float distance) {
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 11, 101L),
                position(3, 5f, 10, 0f, 0f),
                position(4, 5f, 11, distance, 0f));
        return extract(fixture, events)
                .formationPhases()
                .getFirst()
                .clusterCount();
    }

    private TeamBattleFeatureSet extract(
            final Fixture fixture,
            final List<? extends ReplayEvent> events
    ) {
        final ReplayReconstruction reconstruction = reconstruction(fixture, events);
        final TeamPerspectiveResolution perspective =
                TeamPerspectiveResolver.resolve(fixture.battle(), reconstruction);
        return extractor.extract(fixture.battle(), reconstruction, perspective);
    }

    private static Fixture fixture() {
        final PlayerResult allyOne = player(100L, "AllyOne", 1, 400, 100, true, 0);
        final PlayerResult allyTwo = player(101L, "AllyTwo", 1, 300, 200, false, 30_000);
        final PlayerResult enemy = player(200L, "Enemy", 2, 600, 300, true, 0);
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
                position(5, 8f, 10, 10f, 0f),
                position(6, 5f, 11, 500f, 0f),
                position(7, 8f, 11, 510f, 0f),
                position(8, 5f, 20, 1000f, 1000f),
                damage(9, 20f, 10, 20, 200),
                damage(10, 25f, 20, 11, 150),
                damage(11, 30f, 99, 98, 400));
        return new Fixture(battle, participants, events);
    }

    private static Fixture fixtureWithSecondEnemy() {
        final Fixture base = fixture();
        final PlayerResult enemyTwo =
                player(201L, "EnemyTwo", 2, 500, 200, true, 0);
        base.battle().players = new ArrayList<>(base.battle().players);
        base.battle().players.add(enemyTwo);
        final List<BattleParticipant> participants =
                new ArrayList<>(base.participants());
        participants.add(new BattleParticipant(
                201L, "EnemyTwo", 2, 4, "d", false));
        return new Fixture(base.battle(), participants, base.events());
    }

    private static PlayerResult player(
            final long accountId,
            final String nickname,
            final int team,
            final int damageDealt,
            final int damageReceived,
            final boolean survived,
            final long deathTimeMillis
    ) {
        final PlayerResult player = new PlayerResult();
        player.accountId = accountId;
        player.nickname = nickname;
        player.team = team;
        player.damageDealt = damageDealt;
        player.damageReceived = damageReceived;
        player.damageAssisted = 25;
        player.damageBlocked = 50;
        player.kills = 1;
        player.survived = survived;
        player.deathTimeMillis = deathTimeMillis;
        player.tankId = accountId + 1;
        player.tankName = "tank-" + accountId;
        return player;
    }

    private static ParticipantMappingEvent mapping(
            final int sequence,
            final int entityId,
            final long accountId
    ) {
        return new ParticipantMappingEvent(
                sequence, new ReplayTimestamp(sequence, null), 8,
                DecodeConfidence.EXACT, entityId, accountId);
    }

    private static PositionChangedEvent position(
            final int sequence,
            final float time,
            final int entityId,
            final float x,
            final float z
    ) {
        return position(
                sequence, time, entityId, x, z, DecodeConfidence.EXACT);
    }

    private static PositionChangedEvent position(
            final int sequence,
            final float time,
            final int entityId,
            final float x,
            final float z,
            final DecodeConfidence confidence
    ) {
        return new PositionChangedEvent(
                sequence, new ReplayTimestamp(time, null), 10,
                confidence, entityId, 0, 0,
                x, 0, z, 0, 0, 0, 0, 0, 0, (byte) 0);
    }

    private static PositionChangedEvent positionWithElevation(
            final int sequence,
            final float time,
            final int entityId,
            final float y
    ) {
        return new PositionChangedEvent(
                sequence, new ReplayTimestamp(time, null), 10,
                DecodeConfidence.EXACT, entityId, 0, 0,
                0, y, 0, 0, 0, 0, 0, 0, 0, (byte) 0);
    }

    private static DamageEvent damage(
            final int sequence,
            final float time,
            final int attacker,
            final int victim,
            final int damage
    ) {
        return new DamageEvent(
                sequence, new ReplayTimestamp(time, null), 8,
                DecodeConfidence.EXACT, attacker, victim,
                null, null, damage, false);
    }

    private static ReplayReconstruction reconstruction(
            final Fixture fixture,
            final List<? extends ReplayEvent> events
    ) {
        final ReplayCoverage coverage = new ReplayCoverage(
                true, events.size(), events.size(), 0, 0, 0,
                1.0, Map.of());
        return new ReplayReconstruction(
                null, null, 120f, null,
                fixture.participants(), List.copyOf(events), List.of(), null,
                coverage, null);
    }

    private record Fixture(
            Battle battle,
            List<BattleParticipant> participants,
            List<ReplayEvent> events
    ) {
    }
}
