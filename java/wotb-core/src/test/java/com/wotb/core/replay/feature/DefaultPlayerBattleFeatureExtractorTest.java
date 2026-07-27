package com.wotb.core.replay.feature;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.replay.reconstruction.Vector3;

import com.wotb.core.processing.RecorderEntityMapping;
import com.wotb.core.replay.event.BattleEndedEvent;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ParticipantMappingEvent;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.ReplayCoverage;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

class DefaultPlayerBattleFeatureExtractorTest {

    private static final float BATTLE_START_RAW = 10f;

    private static ReplayTimestamp ts(final float rawSec) {
        return new ReplayTimestamp(rawSec, null);
    }

    private static PositionChangedEvent position(final int seq, final float time, final int eid,
                                                  final float x, final float z) {
        return new PositionChangedEvent(seq, ts(time), 10, DecodeConfidence.EXACT, eid, 0, 0,
                x, 0, z, 0, 0, 0, 0, 0, 0, (byte) 0);
    }

    private static DamageEvent damage(final int seq, final float time, final int att, final int vic, final int dmg) {
        return new DamageEvent(seq, ts(time), 8, DecodeConfidence.EXACT, att, vic, null, null, dmg, false);
    }

    private static BattleEndedEvent battleEnd(final int seq, final float time) {
        return new BattleEndedEvent(seq, ts(time), 14, DecodeConfidence.EXACT, 1);
    }

    private static ParticipantMappingEvent mapping(final int seq, final int eid, final long aid) {
        return new ParticipantMappingEvent(seq, ts(seq), 8, DecodeConfidence.EXACT, eid, aid);
    }

    private static ReplayReconstruction recon(final Float battleStartRaw, final List<ReplayEvent> events) {
        final ReplayCoverage coverage = new ReplayCoverage(true, events.size(), events.size(), 0, 0, 0, 1.0, Map.of());
        return new ReplayReconstruction(null, null, 120f, battleStartRaw, List.of(), List.copyOf(events), List.of(), null, coverage, null);
    }

    private static RecorderEntityMapping recorderMapping() {
        return new RecorderEntityMapping(1001L, 1, 1, "Recorder", 1, 1, DecodeConfidence.EXACT);
    }

    @Test
    void preBattlePositionsExcludedFromMovement() {
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        position(2, 5f, 1, 0f, 0f),
                        position(3, BATTLE_START_RAW, 1, 10f, 0f))), recorderMapping(), null);
        assertEquals(1, features.movements().size());
        assertTrue(features.movements().getFirst().startTime() >= 0f);
    }

    @Test
    void preBattleDamageExcludedFromEngagement() {
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        mapping(2, 2, 2001L),
                        damage(3, 5f, 1, 2, 100),
                        damage(4, BATTLE_START_RAW, 1, 2, 200))), recorderMapping(), null);
        assertEquals(1, features.engagements().size());
        assertEquals(0f, features.engagements().getFirst().startTime(), 0.01f);
        assertEquals(200, features.engagements().getFirst().damageDealt());
        assertFalse(features.engagements().getFirst().damageDealt() == 100);
    }

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
                        damage(4, BATTLE_START_RAW + 8f, 1, 2, 150))), recorderMapping(), null);
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
                        damage(3, BATTLE_START_RAW + 3f, 1, 2, 100))), recorderMapping(), null);
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
    void firstContactIsRelative() {
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        mapping(2, 2, 2001L),
                        position(3, BATTLE_START_RAW, 1, 0f, 0f),
                        damage(4, BATTLE_START_RAW + 2f, 1, 2, 100))), recorderMapping(), null);
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
                        damage(4, BATTLE_START_RAW + 2f, 1, 2, 200))), recorderMapping(), null);
        assertFalse(features.keyEvents().isEmpty());
        assertEquals(2f, features.keyEvents().getFirst().clockSec(), 0.01f);
    }

    // ===== Movement in canonical meters (Finding #9) =====

    @Test
    void movementDistanceAndSpeedUseCanonicalMeters() {
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        position(2, BATTLE_START_RAW, 1, 0f, 0f),
                        position(3, BATTLE_START_RAW + 5f, 1, 400f, 0f))), recorderMapping(), null);
        assertEquals(1, features.movements().size());
        final MovementSegment movement = features.movements().getFirst();
        // raw (0,0)->(400,0) == canonical (250,250)->(350,250) == 100 canonical meters over 5s.
        assertEquals(100f, movement.distance(), 0.01f);
        assertEquals(20f, movement.averageSpeed(), 0.01f);
        assertEquals(MovementType.MOVING, movement.type());
    }

    @Test
    void stationaryThresholdIsInCanonicalMeters() {
        // raw delta 10 == canonical 2.5m < 3m threshold -> STATIONARY (MOVING if raw units used).
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        position(2, BATTLE_START_RAW, 1, 0f, 0f),
                        position(3, BATTLE_START_RAW + 5f, 1, 10f, 0f))), recorderMapping(), null);
        assertEquals(1, features.movements().size());
        assertEquals(MovementType.STATIONARY, features.movements().getFirst().type());
    }

    @Test
    void invalidTimeDeltaProducesNoInfiniteOrNaNSpeed() {
        // two positions at the same clock -> zero time delta -> no fake segment/speed.
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        position(2, BATTLE_START_RAW, 1, 0f, 0f),
                        position(3, BATTLE_START_RAW, 1, 400f, 0f))), recorderMapping(), null);
        for (final MovementSegment movement : features.movements()) {
            assertTrue(Float.isFinite(movement.averageSpeed()), "speed must be finite");
            assertTrue(movement.averageSpeed() >= 0f, "speed must be non-negative");
            assertTrue(Float.isFinite(movement.distance()) && movement.distance() >= 0f);
        }
    }

    @Test
    void outOfRangeCoordinatePositionProducesNoMovement() {
        // raw X 5000 is far beyond the clamp tolerance -> INVALID evidence (NaN/Infinity are
        // already rejected by PositionChangedEvent's own constructor), and must not produce a
        // movement segment nor corrupt distance/speed.
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        position(2, BATTLE_START_RAW, 1, 5000f, 0f))), recorderMapping(), null);
        assertTrue(features.movements().isEmpty());
    }

    @Test
    void movementSegmentRejectsIllegalValues() {
        final Vector3 pos = new Vector3(0f, 0f, 0f);
        assertThrows(IllegalArgumentException.class, () -> new MovementSegment(
                2f, 1f, MovementType.MOVING, pos, pos, 0f, 0f, DecodeConfidence.EXACT)); // start>end
        assertThrows(IllegalArgumentException.class, () -> new MovementSegment(
                -1f, 1f, MovementType.MOVING, pos, pos, 0f, 0f, DecodeConfidence.EXACT)); // negative time
        assertThrows(IllegalArgumentException.class, () -> new MovementSegment(
                0f, 1f, MovementType.MOVING, pos, pos, Float.NaN, 0f, DecodeConfidence.EXACT)); // NaN distance
        assertThrows(IllegalArgumentException.class, () -> new MovementSegment(
                0f, 1f, MovementType.MOVING, pos, pos, 0f, Float.POSITIVE_INFINITY,
                DecodeConfidence.EXACT)); // infinite speed
    }

    // ===== Dual-clock timestamp helpers =====

    private static ReplayTimestamp ts(final float rawSec, final Float battleSec) {
        return new ReplayTimestamp(rawSec, battleSec);
    }

    private static PositionChangedEvent position(final int seq, final float raw, final Float battle,
                                                  final int eid, final float x, final float z) {
        return new PositionChangedEvent(seq, ts(raw, battle), 10, DecodeConfidence.EXACT, eid, 0, 0,
                x, 0, z, 0, 0, 0, 0, 0, 0, (byte) 0);
    }

    private static DamageEvent damage(final int seq, final float raw, final Float battle,
                                       final int att, final int vic, final int dmg) {
        return new DamageEvent(seq, ts(raw, battle), 8, DecodeConfidence.EXACT, att, vic, null, null, dmg, false);
    }

    // ===== Dual-clock tests =====

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
                        damage(3, 65f, 5f, 1, 2, 100))), recorderMapping(), null);
        assertEquals(1, features.engagements().size());
        assertEquals(5f, features.engagements().getFirst().startTime(), 0.01f);
    }

    @Test
    void dualClockKeyEventTimeIsRelative() {
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(60f, List.of(
                        mapping(1, 1, 1001L),
                        mapping(2, 2, 2001L),
                        damage(3, 65f, 5f, 1, 2, 100))), recorderMapping(), null);
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
