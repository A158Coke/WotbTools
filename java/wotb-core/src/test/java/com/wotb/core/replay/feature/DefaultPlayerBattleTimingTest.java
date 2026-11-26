package com.wotb.core.replay.feature;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;

import java.util.List;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;


class DefaultPlayerBattleTimingTest extends DefaultPlayerBattleFeatureTestFixture {
    @Test
    void movementTimesAreRelative() {
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        position(2, BATTLE_START_RAW, 1, 0f, 0f),
                        position(3, BATTLE_START_RAW + 3f, 1, 30f, 0f))), recorderMapping(), null);
        assertEquals(1, features.movements().size());
        assertEquals(0f, features.movements().getFirst().startTime(), 0.01f);
        assertEquals(3f, features.movements().getFirst().endTime(), 0.01f);
    }

    @Test
    void engagementTimesAreRelative() {
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        mapping(2, 2, 2001L),
                        damage(3, BATTLE_START_RAW + 5f, 1, 2, 100),
                        damage(4, BATTLE_START_RAW + 8f, 1, 2, 150),
                        health(5, BATTLE_START_RAW + 4f, 2, 300),
                        health(6, BATTLE_START_RAW + 5f, 2, 200),
                        health(7, BATTLE_START_RAW + 7f, 2, 200),
                        health(8, BATTLE_START_RAW + 8f, 2, 50))), recorderMapping(), null);
        assertEquals(1, features.engagements().size());
        assertEquals(5f, features.engagements().getFirst().startTime(), 0.01f);
        assertEquals(8f, features.engagements().getFirst().endTime(), 0.01f);
    }

    @Test
    void keyEventTimeIsRelative() {
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        mapping(2, 2, 2001L),
                        damage(3, BATTLE_START_RAW + 3f, 1, 2, 100),
                        health(4, BATTLE_START_RAW + 2f, 2, 200),
                        health(5, BATTLE_START_RAW + 3f, 2, 100))), recorderMapping(), null);
        assertFalse(features.keyEvents().isEmpty());
        assertEquals(3f, features.keyEvents().getFirst().clockSec(), 0.01f);
    }

    @Test
    void noNegativeTacticalTimes() {
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        mapping(2, 2, 2001L),
                        position(3, BATTLE_START_RAW, 1, 0f, 0f),
                        damage(4, BATTLE_START_RAW + 2f, 1, 2, 100),
                        battleEnd(5, BATTLE_START_RAW + 30f))), recorderMapping(), null);
        for (final var m : features.movements()) {
            assertTrue(m.startTime() >= 0f, "Movement start must not be negative");
        }
        for (final var e : features.engagements()) {
            assertTrue(e.startTime() >= 0f, "Engagement start must not be negative");
        }
        for (final var e : features.keyEvents()) {
            assertTrue(e.clockSec() >= 0f, "Key event time must not be negative");
        }
        for (final var p : features.phases()) {
            assertTrue(p.startTime() >= 0f, "Phase start must not be negative");
            assertTrue(p.endTime() >= 0f, "Phase end must not be negative");
            assertTrue(p.startTime() <= p.endTime(), "Phase start <= end: " + p.startTime() + " > " + p.endTime());
        }
    }

    @Test
    void unresolvedBattleStartPropagatesLimitation() {
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(null, List.of()), recorderMapping(), null);
        assertTrue(features.limitations().contains("PRE_BATTLE_START_UNRESOLVED"));
    }

    @Test
    void observedDamageMatchingAuthoritativeOmitsPartialLimitation() {
        final Battle battle = new Battle();
        battle.recorder = "Recorder";
        final PlayerResult rec = new PlayerResult();
        rec.accountId = 1001L;
        rec.nickname = "Recorder";
        rec.team = 1;
        rec.damageDealt = 100;
        rec.damageReceived = 50;
        final PlayerResult foe = new PlayerResult();
        foe.accountId = 2001L;
        foe.nickname = "Foe";
        foe.team = 2;
        battle.players = List.of(rec, foe);
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        mapping(2, 2, 2001L),
                        damage(3, BATTLE_START_RAW + 2f, 1, 2, 100),
                        damage(4, BATTLE_START_RAW + 3f, 2, 1, 50),
                        health(5, BATTLE_START_RAW + 1f, 2, 200),
                        health(6, BATTLE_START_RAW + 2f, 2, 100),
                        health(7, BATTLE_START_RAW + 2f, 1, 150),
                        health(8, BATTLE_START_RAW + 3f, 1, 100),
                        battleEnd(9, BATTLE_START_RAW + 30f))), recorderMapping(), battle);
        assertFalse(features.limitations().contains("OBSERVED_DAMAGE_IS_PARTIAL"),
                "观测=权威时不得标记 PARTIAL：" + features.limitations());
    }

    @Test
    void firstContactIsRelative() {
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        mapping(2, 2, 2001L),
                        position(3, BATTLE_START_RAW, 1, 0f, 0f),
                        damage(4, BATTLE_START_RAW + 2f, 1, 2, 100),
                        health(5, BATTLE_START_RAW + 1f, 2, 200),
                        health(6, BATTLE_START_RAW + 2f, 2, 100))), recorderMapping(), null);
        assertFalse(features.keyEvents().isEmpty());
        assertEquals(2f, features.keyEvents().getFirst().clockSec(), 0.01f);
    }

    @Test
    void preBattleDamageNotInFirstContact() {
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        mapping(2, 2, 2001L),
                        damage(3, 5f, 1, 2, 100),
                        damage(4, BATTLE_START_RAW + 2f, 1, 2, 200),
                        health(5, BATTLE_START_RAW + 1f, 2, 300),
                        health(6, BATTLE_START_RAW + 2f, 2, 100))), recorderMapping(), null);
        assertFalse(features.keyEvents().isEmpty());
        assertEquals(2f, features.keyEvents().getFirst().clockSec(), 0.01f);
    }

    @Test
    void dualClockMovementTimesAreRelative() {
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(60f, List.of(
                        mapping(1, 1, 1001L),
                        position(2, 65f, 5f, 1, 0f, 0f))), recorderMapping(), null);
        assertEquals(1, features.movements().size());
        assertEquals(5f, features.movements().getFirst().startTime(), 0.01f);
        assertEquals(5f, features.movements().getFirst().endTime(), 0.01f);
    }

    @Test
    void dualClockEngagementTimesAreRelative() {
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(60f, List.of(
                        mapping(1, 1, 1001L),
                        mapping(2, 2, 2001L),
                        damage(3, 65f, 5f, 1, 2, 100),
                        health(4, 64f, 4f, 2, 200),
                        health(5, 65f, 5f, 2, 100))), recorderMapping(), null);
        assertEquals(1, features.engagements().size());
        assertEquals(5f, features.engagements().getFirst().startTime(), 0.01f);
    }

    @Test
    void dualClockKeyEventTimeIsRelative() {
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(60f, List.of(
                        mapping(1, 1, 1001L),
                        mapping(2, 2, 2001L),
                        damage(3, 65f, 5f, 1, 2, 100),
                        health(4, 64f, 4f, 2, 200),
                        health(5, 65f, 5f, 2, 100))), recorderMapping(), null);
        assertFalse(features.keyEvents().isEmpty());
        assertEquals(5f, features.keyEvents().getFirst().clockSec(), 0.01f);
    }

    @Test
    void unresolvedStartWithValidBattleClock() {
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(null, List.of(
                        mapping(1, 1, 1001L),
                        position(2, 120f, 20f, 1, 0f, 0f))), recorderMapping(), null);
        assertEquals(1, features.movements().size());
        assertEquals(20f, features.movements().getFirst().startTime(), 0.01f);
    }

    @Test
    void unresolvedStartWithRawOnlyNoNaN() {
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(null, List.of(
                        mapping(1, 1, 1001L),
                        position(2, 120f, null, 1, 0f, 0f),
                        position(3, 130f, null, 1, 30f, 0f))), recorderMapping(), null);
        assertTrue(features.movements().isEmpty());
    }

    @Test
    void authoritativeDurationUsedWhenNoBattleEndEvent() {
        final Battle battle = new Battle();
        battle.durationS = 120.0;
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        mapping(2, 2, 2001L),
                        damage(3, BATTLE_START_RAW + 5f, 1, 2, 100))), recorderMapping(), battle);
        assertFalse(features.phases().isEmpty());
        assertTrue(features.phases().getLast().endTime() <= 120f);
    }

    @Test
    void authoritativeDurationTakesPriorityOverConflictingEvent() {
        final Battle battle = new Battle();
        battle.durationS = 120.0;
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        mapping(2, 2, 2001L),
                        damage(3, BATTLE_START_RAW + 5f, 1, 2, 100),
                        battleEnd(4, BATTLE_START_RAW + 50f))), recorderMapping(), battle);
        assertFalse(features.phases().isEmpty());
        assertEquals(120f, features.phases().getLast().endTime(), 0.01f);
    }

    @Test
    void nullDurationProducesEmptyPhases() {
        final Battle battle = new Battle();
        battle.durationS = null;
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of()), recorderMapping(), battle);
        assertTrue(features.phases().isEmpty());
    }

    @Test
    void nanDurationProducesEmptyPhases() {
        final Battle battle = new Battle();
        battle.durationS = Double.NaN;
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of()), recorderMapping(), battle);
        assertTrue(features.phases().isEmpty());
    }

    @Test
    void negativeDurationProducesEmptyPhases() {
        final Battle battle = new Battle();
        battle.durationS = -1.0;
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of()), recorderMapping(), battle);
        assertTrue(features.phases().isEmpty());
    }

    @Test
    void eventFallbackUsedWhenDurationNull() {
        final Battle battle = new Battle();
        battle.durationS = null;
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        mapping(2, 2, 2001L),
                        damage(3, BATTLE_START_RAW + 5f, 1, 2, 100),
                        battleEnd(4, BATTLE_START_RAW + 80f))), recorderMapping(), battle);
        assertFalse(features.phases().isEmpty());
        assertEquals(80f, features.phases().getLast().endTime(), 0.01f);
    }

    @Test
    void lastEvidenceFallbackUsedWhenDurationAndEventUnavailable() {
        final Battle battle = new Battle();
        battle.durationS = null;
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        mapping(2, 2, 2001L),
                        position(3, BATTLE_START_RAW, 1, 0f, 0f),
                        position(4, BATTLE_START_RAW + 5f, 1, 10f, 0f),
                        position(5, BATTLE_START_RAW + 10f, 1, 20f, 0f),
                        damage(6, BATTLE_START_RAW + 90f, 1, 2, 100),
                        health(7, BATTLE_START_RAW + 89f, 2, 200),
                        health(8, BATTLE_START_RAW + 90f, 2, 100))), recorderMapping(), battle);
        assertFalse(features.phases().isEmpty());
        assertEquals(90f, features.phases().getLast().endTime(), 0.01f);
    }

    @Test
    void otherPlayerEventsDoNotExtendPlayerPhase() {
        final Battle battle = new Battle();
        battle.durationS = null;
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        position(2, BATTLE_START_RAW + 200f, 2, 0f, 0f),
                        position(3, BATTLE_START_RAW + 50f, 1, 100f, 0f))), recorderMapping(), battle);
        assertFalse(features.phases().isEmpty());
        assertEquals(50f, features.phases().getLast().endTime(), 0.01f);
    }

    @Test
    void durationZeroFallsBackToEvent() {
        final Battle battle = new Battle();
        battle.durationS = 0.0;
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        mapping(2, 2, 2001L),
                        damage(3, BATTLE_START_RAW + 5f, 1, 2, 100),
                        battleEnd(4, BATTLE_START_RAW + 80f))), recorderMapping(), battle);
        assertFalse(features.phases().isEmpty());
        assertEquals(80f, features.phases().getLast().endTime(), 0.01f);
    }

    @Test
    void durationZeroWithoutEventFallsBackToLocal() {
        final Battle battle = new Battle();
        battle.durationS = 0.0;
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        mapping(2, 2, 2001L),
                        damage(3, BATTLE_START_RAW + 50f, 1, 2, 100),
                        health(4, BATTLE_START_RAW + 49f, 2, 200),
                        health(5, BATTLE_START_RAW + 50f, 2, 100))), recorderMapping(), battle);
        assertFalse(features.phases().isEmpty());
        assertEquals(50f, features.phases().getLast().endTime(), 0.01f);
    }

    @Test
    void unresolvedBattleEndHasExplicitLimitation() {
        final Battle battle = new Battle();
        battle.durationS = null;
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(mapping(1, 1, 1001L))), recorderMapping(), battle);
        assertTrue(features.phases().isEmpty());
        assertTrue(features.limitations().contains("BATTLE_END_UNRESOLVED"));
    }

    @Test
    void battleOnlyWithNaNPosition() {
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(null, List.of(
                        mapping(1, 1, 1001L),
                        position(2, Float.NaN, 20f, 1, 0f, 0f),
                        position(3, Float.NaN, 25f, 1, 30f, 0f))), recorderMapping(), null);
        assertEquals(1, features.movements().size());
        assertEquals(20f, features.movements().getFirst().startTime(), 0.01f);
    }
}
