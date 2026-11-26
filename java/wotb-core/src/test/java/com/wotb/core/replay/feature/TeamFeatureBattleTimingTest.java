package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.RoundFinishedEvent;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import org.junit.jupiter.api.Test;
import java.util.ArrayList;
import java.util.List;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;


class TeamFeatureBattleTimingTest extends DefaultTeamBattleFeatureFixture {
    @Test
    void replayBattleEndKeepsItsSourceAndConfidence() {
        final Fixture fixture = fixture();
        fixture.battle().durationS = null;
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                new RoundFinishedEvent(
                        2, new ReplayTimestamp(120f, null), 14,
                        DecodeConfidence.INFERRED, 1, 1, RoundFinishedEvent.FinishCause.ELIMINATION));

        final KeyBattleEvent battleEnd = extractWithStart(fixture, events, 30f).keyEvents().stream()
                .filter(event -> "BATTLE_END".equals(event.type()))
                .findFirst()
                .orElseThrow();

        assertEquals(90f, battleEnd.clockSec());
        assertEquals("REPLAY_EVENT", battleEnd.source());
        assertEquals(DecodeConfidence.INFERRED, battleEnd.confidence());
    }
    @Test
    void preBattleDamageExcludedFromTeamTacticalStats() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 20, 200L),
                damage(3, 5f, 10, 20, 100),
                damage(4, 12f, 10, 20, 200),
                health(5, 11f, 20, 500), health(6, 12f, 20, 300));

        final TeamBattleFeatureSet features = extractWithStart(fixture, events, 10f);

        assertEquals(200, features.observedAggregate().damageDealt());
        assertEquals(1, features.observedAggregate().attributedDamageEventCount());
        assertEquals(0, features.observedAggregate().unattributedDamageEventCount());
        final KeyBattleEvent firstContact = features.keyEvents().stream()
                .filter(event -> "TEAM_FIRST_CONTACT".equals(event.type()))
                .findFirst()
                .orElseThrow();
        assertEquals(2f, firstContact.clockSec(), 0.01f);
        assertEquals("damage=200", firstContact.label());
        assertEquals(1, features.engagements().size());
        assertEquals(2f, features.engagements().getFirst().startTime(), 0.01f);
        assertEquals(200, features.engagements().getFirst().damageDealt());
        assertTrue(features.keyEvents().stream().allMatch(event -> event.clockSec() >= 0f));
        assertTrue(features.engagements().stream().allMatch(engagement -> engagement.startTime() >= 0f));
    }
    @Test
    void preBattleUnattributedDamageDoesNotIncreaseUnattributedCount() {
        final Fixture fixture = fixture();
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                mapping(2, 20, 200L),
                damage(3, 50f, 98, 99, 100),
                damage(4, 150f, 10, 20, 200),
                health(5, 149f, 20, 500), health(6, 150f, 20, 300));

        final TeamBattleFeatureSet features = extractWithStart(fixture, events, 100f);

        assertEquals(0, features.observedAggregate().unattributedDamageEventCount());
        assertEquals(200, features.observedAggregate().damageDealt());
    }
    @Test
    void replayBattleEndConvertedToBattleRelativeClock() {
        final Fixture fixture = fixture();
        fixture.battle().durationS = null;
        final List<ReplayEvent> events = List.of(
                mapping(1, 10, 100L),
                new RoundFinishedEvent(2, new ReplayTimestamp(240f, null), 14,
                        DecodeConfidence.INFERRED, 1, 1, RoundFinishedEvent.FinishCause.ELIMINATION));

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
        fixture.battle().durationS = null;
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
        fixture.battle().durationS = 120.0;
        final List<ReplayEvent> events = List.of(mapping(1, 10, 100L));

        final TeamBattleFeatureSet features = extractWithStart(fixture, events, 60f);

        final KeyBattleEvent battleEnd = features.keyEvents().stream()
                .filter(event -> "BATTLE_END".equals(event.type()))
                .findFirst()
                .orElseThrow();
        assertEquals(120f, battleEnd.clockSec(), 0.01f);
    }
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
    @Test
    void preBattleClampedPositionNotObservedNorClamped() {
        final Fixture fixture = fixture();
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
                position(2, Float.NaN, 10, 255f, 0f));

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
                position(2, 5f, 10, 255f, 0f));

        final TeamFeatureCoverage coverage = extract(fixture, events).coverage();

        assertEquals(1, coverage.observedPositionEventCount());
        assertEquals(1, coverage.clampedPositionEventCount());
        assertTrue(coverage.clampedPositionEventCount()
                <= coverage.observedPositionEventCount());
    }
}



