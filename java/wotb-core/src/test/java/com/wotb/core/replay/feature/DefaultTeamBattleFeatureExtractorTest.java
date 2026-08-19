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
                .noneMatch(movement -> movement.rawStartPosition().x() >= 900
                        || movement.rawEndPosition().x() >= 900));
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
                damage(12, 35f, 20, 11, 200));
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
                damage(5, 20f, 10, 20, 100));
        final ReplayReconstruction reconstruction = new ReplayReconstruction(
                null, null, 60f, 0f, participants, events,
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
        // Invalid-timestamp damage is reported ONLY as invalid-timestamp coverage; it must NOT
        // also inflate the unattributed tactical damage count (those two are distinct classes).
        assertEquals(0, features.coverage().unattributedDamageEventCount());
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
    void supremacyMissingWinner_neitherTeamWiped_pointsLeadFailsClosed() {
        final Fixture fixture = fixture();
        fixture.battle().winnerTeam = null;
        // allyOne(1) 存活, allyTwo(1) 阵亡, enemy(2) 存活 → 双方均未全灭 → 点数判定
        fixture.battle().players.get(0).victoryPointsEarned = 400;
        fixture.battle().players.get(2).victoryPointsEarned = 100;

        final TeamBattleFeatureSet features = extract(fixture, List.of());

        // 无权威胜方：禁止按占点分推断胜方 → win 未知（fail closed）
        assertEquals(null, features.authoritativeAggregate().win());
    }

    @Test
    void supremacyMissingWinner_enemyWiped_friendlyWinsBySettlement() {
        final Fixture fixture = fixture();
        fixture.battle().winnerTeam = null;
        fixture.battle().players.get(2).survived = false; // 敌方全灭

        final TeamBattleFeatureSet features = extract(fixture, List.of());

        assertEquals(Boolean.TRUE, features.authoritativeAggregate().win());
    }

    @Test
    void replayBattleEndKeepsItsSourceAndConfidence() {
        final Fixture fixture = fixture();
        fixture.battle().durationS = null;
        // Non-zero battle start (raw 30): BattleEndedEvent raw 120 must convert to relative 90,
        // proving the conversion actually runs rather than being hidden by a zero clock.
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                new BattleEndedEvent(
                        2, new ReplayTimestamp(120f, null), 14,
                        DecodeConfidence.INFERRED, 1));

        final KeyBattleEvent battleEnd = extractWithStart(fixture, events, 30f).keyEvents().stream()
                .filter(event -> "BATTLE_END".equals(event.type()))
                .findFirst()
                .orElseThrow();

        assertEquals(90f, battleEnd.clockSec());   // 120 raw - 30 battle start
        assertEquals("REPLAY_EVENT", battleEnd.source());
        assertEquals(DecodeConfidence.INFERRED, battleEnd.confidence());
    }

    // ===== Pre-battle damage exclusion (Finding #3) =====

    @Test
    void preBattleDamageExcludedFromTeamTacticalStats() {
        final Fixture fixture = fixture();
        // battle start raw = 10; damage at raw 5 is pre-battle, at raw 12 is in-battle (relative 2).
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 20, 200L),
                damage(3, 5f, 10, 20, 100),    // pre-battle -> excluded everywhere
                damage(4, 12f, 10, 20, 200));  // in-battle -> exactly this counts

        final TeamBattleFeatureSet features = extractWithStart(fixture, events, 10f);

        // Observed damage is exactly the in-battle 200, never 300.
        assertEquals(200, features.observedAggregate().damageDealt());
        assertEquals(1, features.observedAggregate().attributedDamageEventCount());
        assertEquals(0, features.observedAggregate().unattributedDamageEventCount());
        // First contact is the in-battle damage at relative 2s (not pre-battle 100 at relative -5).
        final KeyBattleEvent firstContact = features.keyEvents().stream()
                .filter(event -> "TEAM_FIRST_CONTACT".equals(event.type()))
                .findFirst()
                .orElseThrow();
        assertEquals(2f, firstContact.clockSec(), 0.01f);
        assertEquals("damage=200", firstContact.label());
        // Exactly one engagement, driven only by the in-battle damage, starting at relative 2s.
        assertEquals(1, features.engagements().size());
        assertEquals(2f, features.engagements().getFirst().startTime(), 0.01f);
        assertEquals(200, features.engagements().getFirst().damageDealt());
        // No tactical time is negative (pre-battle would have produced relative -5).
        assertTrue(features.keyEvents().stream().allMatch(event -> event.clockSec() >= 0f));
        assertTrue(features.engagements().stream().allMatch(engagement -> engagement.startTime() >= 0f));
    }

    @Test
    void preBattleUnattributedDamageDoesNotIncreaseUnattributedCount() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 20, 200L),
                damage(3, 50f, 98, 99, 100),    // pre-battle + unmapped -> excluded, NOT unattributed
                damage(4, 150f, 10, 20, 200));

        final TeamBattleFeatureSet features = extractWithStart(fixture, events, 100f);

        assertEquals(0, features.observedAggregate().unattributedDamageEventCount());
        assertEquals(200, features.observedAggregate().damageDealt());
    }

    // ===== Battle-end / fallback clock is battle-relative (Finding #4) =====

    @Test
    void replayBattleEndConvertedToBattleRelativeClock() {
        final Fixture fixture = fixture();
        fixture.battle().durationS = null;   // force replay-event battle end
        // battle start raw = 60, BattleEndedEvent raw = 240 -> relative end 180.
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                new BattleEndedEvent(2, new ReplayTimestamp(240f, null), 14,
                        DecodeConfidence.INFERRED, 1));

        final TeamBattleFeatureSet features = extractWithStart(fixture, events, 60f);

        final KeyBattleEvent battleEnd = features.keyEvents().stream()
                .filter(event -> "BATTLE_END".equals(event.type()))
                .findFirst()
                .orElseThrow();
        assertEquals(180f, battleEnd.clockSec(), 0.01f);
        assertTrue(features.battlePhases().stream()
                .noneMatch(phase -> phase.endTime() == 240f));
        assertTrue(features.battlePhases().stream()
                .allMatch(phase -> phase.endTime() <= 180f + 0.01f));
    }

    @Test
    void lastObservedClockFallbackIsBattleRelative() {
        final Fixture fixture = fixture();
        fixture.battle().durationS = null;   // no authoritative duration, no BattleEndedEvent
        // battle start raw = 60, last observed raw = 150 -> relative fallback 90.
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 20, 200L),
                damage(3, 120f, 10, 20, 100),
                position(4, 150f, 10, 0f, 0f));

        final TeamBattleFeatureSet features = extractWithStart(fixture, events, 60f);

        assertTrue(features.battlePhases().stream()
                .anyMatch(phase -> Math.abs(phase.endTime() - 90f) < 0.01f));
        assertTrue(features.battlePhases().stream()
                .noneMatch(phase -> phase.endTime() >= 150f));
    }

    @Test
    void authoritativeDurationIsNotReSubtractedByBattleStart() {
        final Fixture fixture = fixture();
        fixture.battle().durationS = 120.0;   // authoritative battle-relative duration
        // Even with a resolved raw battle start of 60, durationS must be used as-is (120).
        final List<ReplayEvent> events = List.of(mapping(1, 10, 100L));

        final TeamBattleFeatureSet features = extractWithStart(fixture, events, 60f);

        final KeyBattleEvent battleEnd = features.keyEvents().stream()
                .filter(event -> "BATTLE_END".equals(event.type()))
                .findFirst()
                .orElseThrow();
        assertEquals(120f, battleEnd.clockSec(), 0.01f);
    }

    // ===== Enemy-only damage does not affect team battle phases =====

    @Test
    void enemyOnlyDamageProducesEmptyPhases() {
        final Fixture fixture = fixture();
        fixture.battle().durationS = null;
        final List<BattleParticipant> participants = new ArrayList<>(fixture.participants());
        participants.add(new BattleParticipant(202L, "EnemyTwo", 2, 99, "e", false));
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 11, 101L),
                mapping(3, 20, 200L),
                mapping(4, 99, 202L),
                damage(5, 50f, 20, 99, 200));
        final TeamBattleFeatureSet features = extract(
                new Fixture(fixture.battle(), participants, events), events);
        assertTrue(features.battlePhases().isEmpty());
    }

    @Test
    void enemyOnlyDamageDoesNotExtendFallbackPhaseEnd() {
        final Fixture fixture = fixture();
        fixture.battle().durationS = null;
        final List<BattleParticipant> participants = new ArrayList<>(fixture.participants());
        participants.add(new BattleParticipant(202L, "EnemyTwo", 2, 99, "e", false));
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 11, 101L),
                mapping(3, 20, 200L),
                mapping(4, 99, 202L),
                position(5, 90f, 10, 0f, 0f),
                damage(6, 150f, 20, 99, 200));
        final TeamBattleFeatureSet features = extract(
                new Fixture(fixture.battle(), participants, events), events);
        assertFalse(features.battlePhases().isEmpty());
        assertTrue(features.battlePhases().stream()
                .noneMatch(phase -> phase.endTime() >= 150f));
        assertTrue(features.battlePhases().stream()
                .anyMatch(phase -> Math.abs(phase.endTime() - 90f) < 0.01f));
    }

    @Test
    void enemyOnlyDamageDoesNotChangeFirstContact() {
        final Fixture fixture = fixture();
        final List<BattleParticipant> participants = new ArrayList<>(fixture.participants());
        participants.add(new BattleParticipant(202L, "EnemyTwo", 2, 99, "e", false));
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 11, 101L),
                mapping(3, 20, 200L),
                mapping(4, 99, 202L),
                damage(5, 20f, 20, 99, 200),
                damage(6, 40f, 10, 20, 200));
        final TeamBattleFeatureSet features = extract(
                new Fixture(fixture.battle(), participants, events), events);
        final KeyBattleEvent firstContact = features.keyEvents().stream()
                .filter(event -> "TEAM_FIRST_CONTACT".equals(event.type()))
                .findFirst()
                .orElseThrow();
        assertEquals(40f, firstContact.clockSec(), 0.01f);
        final BattlePhaseSummary firstContactPhase = features.battlePhases().stream()
                .filter(phase -> phase.type() == BattlePhaseType.FIRST_CONTACT)
                .findFirst()
                .orElseThrow();
        assertEquals(40f, firstContactPhase.startTime(), 0.01f);
        assertTrue(features.keyEvents().stream()
                .noneMatch(event -> "TEAM_FIRST_CONTACT".equals(event.type())
                        && Math.abs(event.clockSec() - 20f) < 0.01f));
    }

    @Test
    void authoritativeDurationStillRespectedWithEnemyOnlyDamage() {
        final Fixture fixture = fixture();
        fixture.battle().durationS = 120.0;
        final List<BattleParticipant> participants = new ArrayList<>(fixture.participants());
        participants.add(new BattleParticipant(202L, "EnemyTwo", 2, 99, "e", false));
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 11, 101L),
                mapping(3, 20, 200L),
                mapping(4, 99, 202L),
                position(5, 5f, 10, 0f, 0f),
                damage(6, 150f, 20, 99, 200));
        final TeamBattleFeatureSet features = extract(
                new Fixture(fixture.battle(), participants, events), events);
        assertFalse(features.battlePhases().isEmpty());
        assertTrue(features.battlePhases().stream()
                .noneMatch(phase -> phase.endTime() >= 150f));
        assertTrue(features.battlePhases().stream()
                .allMatch(phase -> phase.endTime() <= 120f + 0.01f));
    }

    // ===== Position audit clamped<=observed + pre-battle/invalid (Finding #5) =====

    @Test
    void preBattleClampedPositionNotObservedNorClamped() {
        final Fixture fixture = fixture();
        // battle start raw = 100; position at raw clock 50 is pre-battle. raw X 1020 -> CLAMPED.
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                position(2, 50f, 10, 255f, 0f));

        final TeamFeatureCoverage coverage =
                extractWithStart(fixture, events, 100f).coverage();

        assertEquals(0, coverage.observedPositionEventCount());
        assertEquals(0, coverage.clampedPositionEventCount());
    }

    @Test
    void invalidTimestampClampedPositionNotObservedNorClamped() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                position(2, Float.NaN, 10, 255f, 0f));   // clamped coord but invalid clock

        final TeamFeatureCoverage coverage = extract(fixture, events).coverage();

        assertEquals(0, coverage.observedPositionEventCount());
        assertEquals(0, coverage.clampedPositionEventCount());
        assertEquals(1, coverage.ignoredInvalidTimestampEventCount());
    }

    @Test
    void inBattleClampedPositionIsObservedAndClamped() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                position(2, 5f, 10, 255f, 0f));   // raw X 1020 -> clamped to 1000

        final TeamFeatureCoverage coverage = extract(fixture, events).coverage();

        assertEquals(1, coverage.observedPositionEventCount());
        assertEquals(1, coverage.clampedPositionEventCount());
        assertTrue(coverage.clampedPositionEventCount()
                <= coverage.observedPositionEventCount());
    }

    @Test
    void inBattleValidPositionIsObservedNotClamped() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                position(2, 5f, 10, 125f, 0f));   // in-bounds -> VALID

        final TeamFeatureCoverage coverage = extract(fixture, events).coverage();

        assertEquals(1, coverage.observedPositionEventCount());
        assertEquals(0, coverage.clampedPositionEventCount());
    }

    @Test
    void enemyPositionNotInPerspectiveCoverage() {
        final Fixture fixture = fixture();
        // entity 20 is enemy team 2; its position must not enter this perspective's coverage,
        // and must not be counted as unattributed either.
        final List<ReplayEvent> events = List.of(
                mapping(1, 20, 200L),
                position(2, 5f, 20, 500f, 0f));

        final TeamFeatureCoverage coverage = extract(fixture, events).coverage();

        assertEquals(0, coverage.observedPositionEventCount());
        assertEquals(0, coverage.clampedPositionEventCount());
        assertEquals(0, coverage.unattributedPositionEventCount());
        assertTrue(coverage.clampedPositionEventCount() <= coverage.observedPositionEventCount());
    }

    // ===== Cluster centroid averages canonical, not raw (Finding #8) =====

    @Test
    void clusterCentroidAveragesCanonicalNotRaw() {
        final Fixture fixture = fixture();
        // raw X {255 (clamped to 250) -> canonical 500, 162.475 -> canonical 412.475}; centroid 456.2375.
        // Averaging raw first (mean 208.7375 -> canonical 458.7375) would be WRONG.
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
        // Exactly one member (raw 1050 -> clamped to 1000) is clamped; centroid derived from a
        // clamped member is itself CLAMPED (not decided by whether the averaged coord is in range).
        assertEquals(1, cluster.clampedMemberPositionCount());
        assertEquals(MapCoordinateResolution.Status.CLAMPED, cluster.centroidStatus());
    }

    // ===== Team member movement uses canonical meters (Finding #9) =====

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
        // entity 10 raw (0,0)->(400,0): canonical (250,250)->(350,250) = 100 canonical meters / 5s.
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                position(2, 10f, 10, 0f, 0f),
                position(3, 15f, 10, 100f, 0f));

        final TeamMemberFeatureSet member = extract(fixture, events).members().stream()
                .filter(candidate -> candidate.accountId() == 100L)
                .findFirst()
                .orElseThrow();

        final MovementSegment movement = member.movements().getFirst();
        assertEquals(100f, movement.distance(), 0.01f);      // canonical meters, not raw 400
        assertEquals(20f, movement.averageSpeed(), 0.01f);   // 100m / 5s
    }

    private TeamBattleFeatureSet extractWithStart(
            final Fixture fixture,
            final List<? extends ReplayEvent> events,
            final Float battleStartRaw
    ) {
        final ReplayCoverage coverage = new ReplayCoverage(
                true, events.size(), events.size(), 0, 0, 0, 1.0, Map.of());
        final ReplayReconstruction reconstruction = new ReplayReconstruction(
                null, null, 300f, battleStartRaw,
                fixture.participants(), List.copyOf(events), List.of(), null,
                coverage, null);
        final TeamPerspectiveResolution perspective =
                TeamPerspectiveResolver.resolve(fixture.battle(), reconstruction);
        return extractor.extract(fixture.battle(), reconstruction, perspective);
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

    /** Two-position version with separate raw X coordinates. */
    private int formationClusters(final Fixture fixture, final float rawX1, final float rawX2) {
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 11, 101L),
                position(3, 5f, 10, rawX1, 0f),
                position(4, 5f, 11, rawX2, 0f));
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
        // 完整结算阵容（2v1 训练房）：允许 SURVIVOR_SETTLEMENT / 全歼判定
        battle.rosterComplete = true;
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
                null, null, 120f, 0f,
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
