package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.BattleEndedEvent;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.event.VehicleDestroyedEvent;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayMetadata;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class DefaultBattleFeatureExtractorTest {

    private static ReplayTimestamp ts(float sec) {
        return new ReplayTimestamp(sec, sec);
    }

    private static DamageEvent damage(int seq, float sec, int attacker, int victim, int dmg) {
        return new DamageEvent(seq, ts(sec), 8, DecodeConfidence.EXACT,
                attacker, victim, null, null, dmg, false);
    }

    private static ReplayReconstruction reconstruction(List<ReplayEvent> events) {
        final ReplayMetadata meta = new ReplayMetadata(
                "arena-123", "Falls Creek", "10.0", "10.0.0",
                1, "Player", "Tank", 300.0, 1_700_000_000L);
        return new ReplayReconstruction(
                meta, null, 300f, null,
                List.of(), events, List.of(),
                BattleStateSnapshot.empty(), null, null);
    }

    @Test
    void extractsKeyEventsInOrder() {
        final List<ReplayEvent> events = List.of(
                damage(0, 10.0f, 1, 2, 120),                          // first damage → FIRST_BLOOD
                damage(1, 12.0f, 1, 2, 550),                          // >= threshold → DAMAGE_SPIKE
                new VehicleDestroyedEvent(2, ts(12.5f), 8, DecodeConfidence.EXACT, 2, 1, false),
                new BattleEndedEvent(3, ts(300.0f), 14, DecodeConfidence.EXACT, 1));

        final DefaultBattleFeatureExtractor extractor = new DefaultBattleFeatureExtractor();
        final ReplayReconstruction recon = reconstruction(events);

        final BattleFeatureSet set = extractor.extract(recon, recon.finalState());

        assertEquals("arena-123", set.battleId());
        assertTrue(set.hasFeatures());

        final List<KeyBattleEvent> ke = set.keyEvents();
        assertEquals(4, ke.size());
        assertEquals("FIRST_BLOOD", ke.get(0).type());
        assertEquals("DAMAGE_SPIKE", ke.get(1).type());
        assertEquals("VEHICLE_DESTROYED", ke.get(2).type());
        assertEquals("BATTLE_END", ke.get(3).type());
    }

    @Test
    void firstDamageBelowSpikeThresholdIsOnlyFirstBlood() {
        final List<ReplayEvent> events = List.of(
                damage(0, 5.0f, 1, 2, 50),   // first damage, small → FIRST_BLOOD only
                damage(1, 6.0f, 1, 2, 50));  // small, not first → dropped

        final DefaultBattleFeatureExtractor extractor = new DefaultBattleFeatureExtractor();
        final BattleFeatureSet set = extractor.extract(reconstruction(events), BattleStateSnapshot.empty());

        assertEquals(1, set.keyEvents().size());
        assertEquals("FIRST_BLOOD", set.keyEvents().get(0).type());
    }

    // ===== buildRelativePhases boundary regression (Finding #1) =====

    @Test
    void buildRelativePhasesClampsOpeningToBattleEndWhenNoFirstContact() {
        // battleEnd=30, no first contact: OPENING must not extend to the default 45s.
        final List<BattlePhaseSummary> phases =
                DefaultBattleFeatureExtractor.buildRelativePhases(
                        DefaultBattleFeatureExtractor.UNKNOWN_FIRST_CONTACT, 30f);
        assertFalse(phases.isEmpty());
        for (final BattlePhaseSummary phase : phases) {
            assertTrue(phase.endTime() <= 30f,
                    "phase end must not exceed battle end 30: " + phase.endTime());
        }
        assertAllPhasesValid(phases, 30f);
    }

    @Test
    void buildRelativePhasesRejectsFirstContactAfterBattleEnd() {
        // firstContact=40 > battleEnd=30 must NOT yield a [40,30] phase.
        final List<BattlePhaseSummary> phases =
                DefaultBattleFeatureExtractor.buildRelativePhases(40f, 30f);
        assertTrue(phases.stream()
                .noneMatch(phase -> phase.type() == BattlePhaseType.FIRST_CONTACT));
        assertAllPhasesValid(phases, 30f);
    }

    @Test
    void buildRelativePhasesTreatsZeroFirstContactAsValid() {
        // firstContact=0 is a legal battle-relative contact time, not "unknown".
        final List<BattlePhaseSummary> phases =
                DefaultBattleFeatureExtractor.buildRelativePhases(0f, 30f);
        final BattlePhaseSummary firstContact = phases.stream()
                .filter(phase -> phase.type() == BattlePhaseType.FIRST_CONTACT)
                .findFirst()
                .orElseThrow();
        assertEquals(0f, firstContact.startTime());
        assertAllPhasesValid(phases, 30f);
    }

    @Test
    void buildRelativePhasesReturnsStableFallbackForNonFiniteOrNegativeEnd() {
        assertTrue(DefaultBattleFeatureExtractor
                .buildRelativePhases(10f, Float.NaN).isEmpty());
        assertTrue(DefaultBattleFeatureExtractor
                .buildRelativePhases(10f, Float.POSITIVE_INFINITY).isEmpty());
        assertTrue(DefaultBattleFeatureExtractor
                .buildRelativePhases(10f, -5f).isEmpty());
    }

    @Test
    void buildRelativePhasesAlwaysProducesValidPhases() {
        final float[][] cases = {
                {-1f, 0f}, {0f, 0f}, {0f, 30f}, {40f, 30f}, {-1f, 30f},
                {5f, 200f}, {Float.NaN, 200f}, {20f, 20f}, {200f, 20f}
        };
        for (final float[] c : cases) {
            assertAllPhasesValid(
                    DefaultBattleFeatureExtractor.buildRelativePhases(c[0], c[1]), c[1]);
        }
    }

    @Test
    void battlePhaseSummaryRejectsIllegalPhase() {
        assertThrows(IllegalArgumentException.class, () -> new BattlePhaseSummary(
                40f, 30f, BattlePhaseType.FIRST_CONTACT, DecodeConfidence.INFERRED));
        assertThrows(IllegalArgumentException.class, () -> new BattlePhaseSummary(
                Float.NaN, 30f, BattlePhaseType.OPENING, DecodeConfidence.EXACT));
        assertThrows(IllegalArgumentException.class, () -> new BattlePhaseSummary(
                -1f, 30f, BattlePhaseType.OPENING, DecodeConfidence.EXACT));
    }

    private static void assertAllPhasesValid(
            final List<BattlePhaseSummary> phases, final float battleEnd) {
        for (final BattlePhaseSummary phase : phases) {
            assertTrue(Float.isFinite(phase.startTime()) && Float.isFinite(phase.endTime()));
            assertTrue(phase.startTime() >= 0f, "start >= 0");
            assertTrue(phase.endTime() >= 0f, "end >= 0");
            assertTrue(phase.startTime() <= phase.endTime(), "start <= end");
            assertTrue(phase.endTime() <= battleEnd + 0.0001f, "end <= battleEnd");
        }
    }
}
