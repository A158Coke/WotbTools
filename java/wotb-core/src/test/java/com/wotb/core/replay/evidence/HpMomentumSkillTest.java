package com.wotb.core.replay.evidence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

class HpMomentumSkillTest {

    private static List<PlayerResult> eightPlayers() {
        final List<PlayerResult> players = new ArrayList<>();
        for (int i = 1; i <= 4; i++) {
            players.add(EvidenceTestFixtures.player(1000 + i, 1, 4481, "Kranvagn", true, 300));
        }
        for (int i = 1; i <= 4; i++) {
            players.add(EvidenceTestFixtures.player(2000 + i, 2, 10785, "T110E5", true, 300));
        }
        return players;
    }

    private static ReplayReconstruction fullHpRecon() {
        return EvidenceTestFixtures.recon(
                EvidenceTestFixtures.cp(1000f,
                        hp(1, 1001, 1, 1000), hp(2, 1002, 1, 1000),
                        hp(3, 1003, 1, 1000), hp(4, 1004, 1, 1000),
                        hp(5, 2001, 2, 1000), hp(6, 2002, 2, 1000),
                        hp(7, 2003, 2, 1000), hp(8, 2004, 2, 1000)),
                EvidenceTestFixtures.cp(1010f,
                        hp(1, 1001, 1, 1000), hp(2, 1002, 1, 1000),
                        hp(3, 1003, 1, 1000), hp(4, 1004, 1, 1000),
                        hp(5, 2001, 2, 1000), hp(6, 2002, 2, 1000),
                        hp(7, 2003, 2, 1000), hp(8, 2004, 2, 1000)),
                EvidenceTestFixtures.cp(1020f,
                        hp(1, 1001, 1, 1000), hp(2, 1002, 1, 1000),
                        hp(3, 1003, 1, 1000), hp(4, 1004, 1, 1000),
                        hp(5, 2001, 2, 1), hp(6, 2002, 2, 1),
                        hp(7, 2003, 2, 1), hp(8, 2004, 2, 1)),
                EvidenceTestFixtures.cp(1030f,
                        hp(1, 1001, 1, 1000), hp(2, 1002, 1, 1000),
                        hp(3, 1003, 1, 1000), hp(4, 1004, 1, 1000),
                        hp(5, 2001, 2, 1), hp(6, 2002, 2, 1),
                        hp(7, 2003, 2, 1), hp(8, 2004, 2, 1)));
    }

    private static com.wotb.core.replay.reconstruction.VehicleState hp(
            final int entityId, final long accountId, final int team, final int hp) {
        return EvidenceTestFixtures.vehicle(entityId, accountId, team, 0, 0f, 0f, hp);
    }

    @Test
    void detectsCriticalSwingWithFullCoverage() {
        final Battle battle = EvidenceTestFixtures.battle(eightPlayers());
        final ReplayReconstruction recon = fullHpRecon();
        final HpMomentumSkill skill = new HpMomentumSkill();
        final List<HpMomentumSkill.HpMomentumSample> series = skill.sample(recon, battle);
        assertEquals(4, series.size());
        assertEquals(1.0, series.getFirst().observedCoverage(), 1e-9);

        final List<AiEvidence> windows = skill.detect(series);
        assertEquals(1, windows.size());
        final AiEvidence window = windows.getFirst();
        assertEquals(EvidencePriority.CRITICAL, window.priority());
        assertEquals(DecodeConfidence.INFERRED, window.confidence());
        assertEquals(0f, window.startSec());
        assertEquals(30f, window.endSec());
        assertTrue(window.numbers().get("hpSwing") >= 3990);
    }

    @Test
    void partialCoverageLowersConfidenceToPartial() {
        final Battle battle = EvidenceTestFixtures.battle(eightPlayers());
        final ReplayReconstruction recon = EvidenceTestFixtures.recon(
                EvidenceTestFixtures.cp(1000f,
                        hp(1, 1001, 1, 1000), hp(2, 1002, 1, 1000),
                        hp(3, 1003, 1, 1000), hp(4, 1004, 1, 1000),
                        hp(5, 2001, 2, 1000), hp(6, 2002, 2, 1000),
                        hp(7, 2003, 2, 1000)),
                EvidenceTestFixtures.cp(1020f,
                        hp(1, 1001, 1, 1000), hp(2, 1002, 1, 1000),
                        hp(3, 1003, 1, 1000), hp(4, 1004, 1, 1000),
                        hp(5, 2001, 2, 1), hp(6, 2002, 2, 1)));
        final HpMomentumSkill skill = new HpMomentumSkill();
        final List<AiEvidence> windows = skill.detect(skill.sample(recon, battle));
        assertEquals(1, windows.size());
        assertEquals(DecodeConfidence.PARTIAL, windows.getFirst().confidence());
        assertTrue(windows.getFirst().numbers().get("observedCoverage") <= 0.75 + 1e-9);
    }

    @Test
    void noSwingYieldsNoWindow() {
        final Battle battle = EvidenceTestFixtures.battle(eightPlayers());
        final ReplayReconstruction recon = EvidenceTestFixtures.recon(
                EvidenceTestFixtures.cp(1000f,
                        hp(1, 1001, 1, 1000), hp(2, 1002, 1, 1000),
                        hp(3, 1003, 1, 1000), hp(4, 1004, 1, 1000),
                        hp(5, 2001, 2, 1000), hp(6, 2002, 2, 1000),
                        hp(7, 2003, 2, 1000), hp(8, 2004, 2, 1000)),
                EvidenceTestFixtures.cp(1030f,
                        hp(1, 1001, 1, 950), hp(2, 1002, 1, 950),
                        hp(3, 1003, 1, 950), hp(4, 1004, 1, 950),
                        hp(5, 2001, 2, 1000), hp(6, 2002, 2, 1000),
                        hp(7, 2003, 2, 1000), hp(8, 2004, 2, 1000)));
        final HpMomentumSkill skill = new HpMomentumSkill();
        assertTrue(skill.detect(skill.sample(recon, battle)).isEmpty());
    }
}
