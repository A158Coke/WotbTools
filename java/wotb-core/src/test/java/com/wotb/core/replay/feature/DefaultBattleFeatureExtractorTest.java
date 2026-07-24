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
}
