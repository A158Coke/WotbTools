package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.reconstruction.ReplayReconstruction;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

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
                        hp(5, 2001, 2, 1), hp(6, 2002, 2, 1),
                        hp(7, 2003, 2, 1)));
        final HpMomentumSkill skill = new HpMomentumSkill();
        final List<AiEvidence> windows = skill.detect(skill.sample(recon, battle));
        assertEquals(1, windows.size());
        assertEquals(DecodeConfidence.PARTIAL, windows.getFirst().confidence());
        assertTrue(windows.getFirst().numbers().get("observedCoverage") <= 0.875 + 1e-9);
    }

    @Test
    void unspottedEnemyDoesNotCreateFakeSwing() {
        final List<PlayerResult> players = new ArrayList<>();
        players.add(EvidenceTestFixtures.player(1001, 1, 4481, "Kranvagn", true, 300));
        for (int i = 1; i <= 4; i++) {
            players.add(EvidenceTestFixtures.player(2000 + i, 2, 19217, "E 100", true, 300));
        }
        final Battle battle = EvidenceTestFixtures.battle(players);
        final ReplayReconstruction recon = EvidenceTestFixtures.recon(
                EvidenceTestFixtures.cp(1000f,
                        hp(1, 1001, 1, 1000),
                        hp(5, 2001, 2, 1800), hp(6, 2002, 2, 1800),
                        hp(7, 2003, 2, 1800), hp(8, 2004, 2, 1800)),
                EvidenceTestFixtures.cp(1020f,
                        hp(1, 1001, 1, 1000),
                        EvidenceTestFixtures.hiddenVehicle(5, 2001, 2),
                        EvidenceTestFixtures.hiddenVehicle(6, 2002, 2),
                        EvidenceTestFixtures.hiddenVehicle(7, 2003, 2),
                        EvidenceTestFixtures.hiddenVehicle(8, 2004, 2)));
        final HpMomentumSkill skill = new HpMomentumSkill();
        final List<AiEvidence> windows = skill.detect(skill.sample(recon, battle));
        assertTrue(windows.isEmpty(),
                "敌人从 OBSERVED 变为不可观察（unspot）不得制造假的 HP swing");
    }

    @Test
    void realDamageOnCommonEntitiesProducesSwing() {
        final List<PlayerResult> players = new ArrayList<>();
        players.add(EvidenceTestFixtures.player(1001, 1, 4481, "Kranvagn", true, 300));
        for (int i = 1; i <= 4; i++) {
            players.add(EvidenceTestFixtures.player(2000 + i, 2, 19217, "E 100", true, 300));
        }
        final Battle battle = EvidenceTestFixtures.battle(players);
        final ReplayReconstruction recon = EvidenceTestFixtures.recon(
                EvidenceTestFixtures.cp(1000f,
                        hp(1, 1001, 1, 1000),
                        hp(5, 2001, 2, 1800), hp(6, 2002, 2, 1800),
                        hp(7, 2003, 2, 1800), hp(8, 2004, 2, 1800)),
                EvidenceTestFixtures.cp(1020f,
                        hp(1, 1001, 1, 1000),
                        hp(5, 2001, 2, 1000), hp(6, 2002, 2, 1000),
                        hp(7, 2003, 2, 1000), hp(8, 2004, 2, 1000)));
        final HpMomentumSkill skill = new HpMomentumSkill();
        final List<AiEvidence> windows = skill.detect(skill.sample(recon, battle));
        assertEquals(1, windows.size());
        final AiEvidence window = windows.getFirst();
        assertEquals(3200.0, window.numbers().get("hpSwing"));
        assertEquals(-6200.0, window.numbers().get("hpLeadBefore"));
        assertEquals(-3000.0, window.numbers().get("hpLeadAfter"));
        assertEquals(5.0, window.numbers().get("commonEntityCount"));
        assertEquals(DecodeConfidence.INFERRED, window.confidence());
    }

    @Test
    void confirmedDestroyedContributesLethalHpLoss() {
        final List<PlayerResult> players = new ArrayList<>();
        players.add(EvidenceTestFixtures.player(1001, 1, 4481, "Kranvagn", true, 300));
        players.add(EvidenceTestFixtures.player(2001, 2, 19217, "E 100", true, 300));
        players.add(EvidenceTestFixtures.player(2002, 2, 19217, "E 100", true, 300));
        final Battle battle = EvidenceTestFixtures.battle(players);
        final ReplayReconstruction recon = EvidenceTestFixtures.recon(
                EvidenceTestFixtures.cp(1000f,
                        hp(1, 1001, 1, 1000),
                        hp(5, 2001, 2, 1700), hp(6, 2002, 2, 1700)),
                EvidenceTestFixtures.cp(1020f,
                        hp(1, 1001, 1, 1000),
                        EvidenceTestFixtures.destroyedVehicle(5, 2001, 2),
                        EvidenceTestFixtures.destroyedVehicle(6, 2002, 2)));
        final HpMomentumSkill skill = new HpMomentumSkill();
        final List<AiEvidence> windows = skill.detect(skill.sample(recon, battle));
        assertEquals(1, windows.size());
        final AiEvidence window = windows.getFirst();
        assertEquals(3400.0, window.numbers().get("hpSwing"),
                "confirmed destroyed 必须贡献 1700×2 lethal HP loss");
        assertEquals(3.0, window.numbers().get("commonEntityCount"));
    }

    @Test
    void destroyedCountsButUnspotNeverCountsAsDamage() {
        final List<PlayerResult> players = new ArrayList<>();
        players.add(EvidenceTestFixtures.player(1001, 1, 4481, "Kranvagn", true, 300));
        players.add(EvidenceTestFixtures.player(2001, 2, 19217, "E 100", true, 300));
        players.add(EvidenceTestFixtures.player(2002, 2, 10785, "T110E5", true, 300));
        players.add(EvidenceTestFixtures.player(2003, 2, 19217, "E 100", true, 300));
        final Battle battle = EvidenceTestFixtures.battle(players);
        final ReplayReconstruction recon = EvidenceTestFixtures.recon(
                EvidenceTestFixtures.cp(1000f,
                        hp(1, 1001, 1, 1000),
                        hp(5, 2001, 2, 1700), hp(6, 2002, 2, 1500),
                        hp(7, 2003, 2, 1700)),
                EvidenceTestFixtures.cp(1020f,
                        hp(1, 1001, 1, 1000),
                        EvidenceTestFixtures.destroyedVehicle(5, 2001, 2),
                        EvidenceTestFixtures.hiddenVehicle(6, 2002, 2),
                        EvidenceTestFixtures.destroyedVehicle(7, 2003, 2)));
        final HpMomentumSkill skill = new HpMomentumSkill();
        final List<AiEvidence> windows = skill.detect(skill.sample(recon, battle));
        assertEquals(1, windows.size());
        final AiEvidence window = windows.getFirst();
        assertEquals(3400.0, window.numbers().get("hpSwing"),
                "E100 lethal 计入（1700×2），IS-7 消失（1500）不得计入");
        assertEquals(3.0, window.numbers().get("commonEntityCount"),
                "共同可靠实体 = 录像者 + 2 辆被击毁敌车");
    }

    @Test
    void mergedWindowsUseSingleRepresentativeCohort() {
        final List<PlayerResult> players = new ArrayList<>();
        players.add(EvidenceTestFixtures.player(1001, 1, 4481, "Kranvagn", true, 300));
        players.add(EvidenceTestFixtures.player(2001, 2, 19217, "E 100", true, 300));
        players.add(EvidenceTestFixtures.player(2002, 2, 19217, "E 100", true, 300));
        players.add(EvidenceTestFixtures.player(2003, 2, 19217, "E 100", true, 300));
        players.add(EvidenceTestFixtures.player(2004, 2, 19217, "E 100", true, 300));
        final Battle battle = EvidenceTestFixtures.battle(players);
        final ReplayReconstruction recon = EvidenceTestFixtures.recon(
                EvidenceTestFixtures.cp(1000f,
                        hp(1, 1001, 1, 1000),
                        hp(5, 2001, 2, 1700), hp(6, 2002, 2, 1700)),
                EvidenceTestFixtures.cp(1010f,
                        hp(1, 1001, 1, 1000),
                        EvidenceTestFixtures.destroyedVehicle(5, 2001, 2),
                        EvidenceTestFixtures.destroyedVehicle(6, 2002, 2)),
                EvidenceTestFixtures.cp(1020f,
                        hp(1, 1001, 1, 1000),
                        EvidenceTestFixtures.destroyedVehicle(5, 2001, 2),
                        EvidenceTestFixtures.destroyedVehicle(6, 2002, 2),
                        hp(7, 2003, 2, 2500), hp(8, 2004, 2, 2500)),
                EvidenceTestFixtures.cp(1030f,
                        hp(1, 1001, 1, 1000),
                        EvidenceTestFixtures.destroyedVehicle(5, 2001, 2),
                        EvidenceTestFixtures.destroyedVehicle(6, 2002, 2),
                        EvidenceTestFixtures.destroyedVehicle(7, 2003, 2),
                        EvidenceTestFixtures.destroyedVehicle(8, 2004, 2)));
        final HpMomentumSkill skill = new HpMomentumSkill();
        final List<AiEvidence> windows = skill.detect(skill.sample(recon, battle));
        assertEquals(1, windows.size());
        final AiEvidence window = windows.getFirst();
        // 代表 = swing 最大的单个候选（cohort {rec,a,b,c,d}，-4000 → 1000），
        // 不得拼接其它 cohort 的 before/after
        assertEquals(-4000.0, window.numbers().get("hpLeadBefore"));
        assertEquals(1000.0, window.numbers().get("hpLeadAfter"));
        assertEquals(5000.0, window.numbers().get("hpSwing"));
        assertEquals(5.0, window.numbers().get("commonEntityCount"));
        assertEquals(1.0, window.numbers().get("observedCoverage"));
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
