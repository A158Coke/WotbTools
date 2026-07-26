package com.wotb.core.replay.feature;

import static org.junit.jupiter.api.Assertions.*;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
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
        final List<ReplayEvent> events = List.of(
                mapping(1, 1, 1001L),
                position(2, 5f, 1, 0f, 0f),
                position(3, BATTLE_START_RAW, 1, 10f, 0f));
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, events), recorderMapping());
        assertEquals(1, features.movements().size());
        assertTrue(features.movements().getFirst().startTime() >= 0f);
    }

    @Test
    void preBattleDamageExcludedFromEngagement() {
        final List<ReplayEvent> events = List.of(
                mapping(1, 1, 1001L),
                mapping(2, 2, 2001L),
                damage(3, 5f, 1, 2, 100),
                damage(4, BATTLE_START_RAW, 1, 2, 200));
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, events), recorderMapping());
        assertEquals(1, features.engagements().size());
    }

    @Test
    void movementTimesAreRelative() {
        final List<ReplayEvent> events = List.of(
                mapping(1, 1, 1001L),
                position(2, BATTLE_START_RAW, 1, 0f, 0f),
                position(3, BATTLE_START_RAW + 3f, 1, 30f, 0f));
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, events), recorderMapping());
        assertEquals(1, features.movements().size());
        assertEquals(0f, features.movements().getFirst().startTime(), 0.01f);
        assertEquals(3f, features.movements().getFirst().endTime(), 0.01f);
    }

    @Test
    void engagementTimesAreRelative() {
        final List<ReplayEvent> events = List.of(
                mapping(1, 1, 1001L),
                mapping(2, 2, 2001L),
                damage(3, BATTLE_START_RAW + 5f, 1, 2, 100),
                damage(4, BATTLE_START_RAW + 8f, 1, 2, 150));
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, events), recorderMapping());
        assertEquals(1, features.engagements().size());
        assertEquals(5f, features.engagements().getFirst().startTime(), 0.01f);
        assertEquals(8f, features.engagements().getFirst().endTime(), 0.01f);
    }

    @Test
    void keyEventTimeIsRelative() {
        final List<ReplayEvent> events = List.of(
                mapping(1, 1, 1001L),
                mapping(2, 2, 2001L),
                damage(3, BATTLE_START_RAW + 3f, 1, 2, 100));
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, events), recorderMapping());
        assertFalse(features.keyEvents().isEmpty());
        assertEquals(3f, features.keyEvents().getFirst().clockSec(), 0.01f);
    }

    @Test
    void noNegativeTacticalTimes() {
        final List<ReplayEvent> events = List.of(
                mapping(1, 1, 1001L),
                mapping(2, 2, 2001L),
                position(3, BATTLE_START_RAW, 1, 0f, 0f),
                damage(4, BATTLE_START_RAW + 2f, 1, 2, 100),
                battleEnd(5, BATTLE_START_RAW + 30f));
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(BATTLE_START_RAW, events), recorderMapping());
        for (final var m : features.movements()) {
            assertTrue(m.startTime() >= 0f, "Movement start must not be negative: " + m.startTime());
        }
        for (final var e : features.engagements()) {
            assertTrue(e.startTime() >= 0f, "Engagement start must not be negative: " + e.startTime());
        }
        for (final var e : features.keyEvents()) {
            assertTrue(e.clockSec() >= 0f, "Key event time must not be negative: " + e.clockSec());
        }
    }

    @Test
    void unresolvedBattleStartPropagatesLimitation() {
        final var features = new DefaultPlayerBattleFeatureExtractor()
                .extract(recon(null, List.of()), recorderMapping());
        assertTrue(features.limitations().contains("PRE_BATTLE_START_UNRESOLVED"));
    }
}
