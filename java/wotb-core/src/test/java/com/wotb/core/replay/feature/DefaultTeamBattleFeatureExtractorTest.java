package com.wotb.core.replay.feature;

import com.wotb.core.replay.event.BattleEndedEvent;
import com.wotb.core.replay.event.DamageEvent;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.event.PositionChangedEvent;
import com.wotb.core.replay.event.ReplayEvent;
import com.wotb.core.replay.event.ReplayTimestamp;
import com.wotb.core.replay.reconstruction.BattleParticipant;
import com.wotb.core.replay.reconstruction.BattleStateSnapshot;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class DefaultTeamBattleFeatureExtractorTest {
    private final DefaultTeamBattleFeatureExtractor extractor = new DefaultTeamBattleFeatureExtractor();
    private static ReplayTimestamp ts(float sec) { return new ReplayTimestamp(sec, sec); }
    private static PositionChangedEvent pos(int seq, float sec, int eid, float x, float z) {
        return new PositionChangedEvent(seq, ts(sec), 10, DecodeConfidence.EXACT, eid, 0, 0, x, 0, z, 0, 0, 0, 0, 0, 0, (byte)0);
    }
    private static DamageEvent dmg(int seq, float sec, int att, int vic, int d) {
        return new DamageEvent(seq, ts(sec), 8, DecodeConfidence.EXACT, att, vic, null, null, d, false);
    }
    private static ReplayReconstruction recon(List<ReplayEvent> events) {
        return new ReplayReconstruction(null, null, 300f, 5f,
                List.of(new BattleParticipant(1000L, "PlayerA", 1, 0, "T-34", true)),
                List.copyOf(events), List.of(), BattleStateSnapshot.empty(), null, null);
    }
    @Test void extractsMovementSegments() { assertFalse(extractor.extract(recon(List.of(pos(1,10f,10,0,0), pos(2,10.5f,10,5,5))), 1).teamMovements().isEmpty()); }
    @Test void emptyEvents() { assertFalse(extractor.extract(recon(List.of()), 1).hasFeatures()); }
    @Test void keyEvents() {
        final var fs = extractor.extract(recon(List.of(dmg(1,20f,10,20,200), new BattleEndedEvent(2,ts(300f),14,DecodeConfidence.EXACT,1))), 1);
        assertEquals(2, fs.keyEvents().size()); assertEquals("TEAM_FIRST_BLOOD", fs.keyEvents().get(0).type());
    }
    @Test void engagementsArePlaceholder() { assertTrue(extractor.extract(recon(List.of(dmg(1,20f,10,20,200))), 1).teamEngagements().isEmpty()); }
    @Test void phases() { assertFalse(extractor.extract(recon(List.of(dmg(1,30f,10,20,200), new BattleEndedEvent(2,ts(300f),14,DecodeConfidence.EXACT,1))), 1).phases().isEmpty()); }
}
