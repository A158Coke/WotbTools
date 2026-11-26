package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.reconstruction.Vector3;

import java.util.List;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;


class DefaultPlayerBattleFeatureExtractorTest extends DefaultPlayerBattleFeatureTestFixture {
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
                        damage(4, BATTLE_START_RAW + 2f, 1, 2, 200),
                        health(5, BATTLE_START_RAW, 2, 300),
                        health(6, BATTLE_START_RAW + 2f, 2, 100))), recorderMapping(), null);
        assertEquals(1, features.engagements().size());
        assertEquals(2f, features.engagements().getFirst().startTime(), 0.01f);
        assertEquals(200, features.engagements().getFirst().damageDealt());
        assertFalse(features.engagements().getFirst().damageDealt() == 100);
    }

    @Test
    void movementDistanceAndSpeedUseCanonicalMeters() {
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        position(2, BATTLE_START_RAW, 1, 0f, 0f),
                        position(3, BATTLE_START_RAW + 5f, 1, 100f, 0f))), recorderMapping(), null);
        assertEquals(1, features.movements().size());
        final MovementSegment movement = features.movements().getFirst();
        assertEquals(100f, movement.distance(), 0.01f);
        assertEquals(20f, movement.averageSpeed(), 0.01f);
        assertEquals(MovementType.MOVING, movement.type());
    }

    @Test
    void stationaryThresholdIsInCanonicalMeters() {
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        position(2, BATTLE_START_RAW, 1, 0f, 0f),
                        position(3, BATTLE_START_RAW + 5f, 1, 2.5f, 0f))), recorderMapping(), null);
        assertEquals(1, features.movements().size());
        assertEquals(MovementType.STATIONARY, features.movements().getFirst().type());
    }

    @Test
    void invalidTimeDeltaProducesNoInfiniteOrNaNSpeed() {
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, List.of(
                        mapping(1, 1, 1001L),
                        position(2, BATTLE_START_RAW, 1, 0f, 0f),
                        position(3, BATTLE_START_RAW, 1, 100f, 0f))), recorderMapping(), null);
        for (final MovementSegment movement : features.movements()) {
            assertTrue(Float.isFinite(movement.averageSpeed()), "speed must be finite");
            assertTrue(movement.averageSpeed() >= 0f, "speed must be non-negative");
            assertTrue(Float.isFinite(movement.distance()) && movement.distance() >= 0f);
        }
    }

    @Test
    void outOfRangeCoordinatePositionProducesNoMovement() {
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
                2f, 1f, MovementType.MOVING, pos, pos, 0f, 0f, DecodeConfidence.EXACT));
        assertThrows(IllegalArgumentException.class, () -> new MovementSegment(
                -1f, 1f, MovementType.MOVING, pos, pos, 0f, 0f, DecodeConfidence.EXACT));
        assertThrows(IllegalArgumentException.class, () -> new MovementSegment(
                0f, 1f, MovementType.MOVING, pos, pos, Float.NaN, 0f, DecodeConfidence.EXACT));
        assertThrows(IllegalArgumentException.class, () -> new MovementSegment(
                0f, 1f, MovementType.MOVING, pos, pos, 0f, Float.POSITIVE_INFINITY,
                DecodeConfidence.EXACT));
    }
}
