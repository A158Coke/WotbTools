package com.wotb.core.replay.evidence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

class LocalSupportSkillTest {

    private static Battle supportBattle() {
        final List<PlayerResult> players = new ArrayList<>();
        players.add(EvidenceTestFixtures.player(1001, 1, 4481, "Kranvagn", true, 300));
        players.add(EvidenceTestFixtures.player(1002, 1, 4481, "Kranvagn", true, 300));
        players.add(EvidenceTestFixtures.player(1003, 1, 4481, "Kranvagn", true, 300));
        players.add(EvidenceTestFixtures.player(2001, 2, 10785, "T110E5", true, 300));
        players.add(EvidenceTestFixtures.player(2002, 2, 10785, "T110E5", true, 300));
        players.add(EvidenceTestFixtures.player(2003, 2, 10785, "T110E5", true, 300));
        return EvidenceTestFixtures.battle(players);
    }

    @Test
    void emitsEvidenceWhenFullyObservedEnemySupportSurges() {
        final Battle battle = supportBattle();
        final PlayerBattleFeatureSet features = EvidenceTestFixtures.features(
                List.of(EvidenceTestFixtures.engagement(10f, 20f, 100, 100)));
        final EvidenceSkillContext ctx = new EvidenceSkillContext(
                battle,
                EvidenceTestFixtures.recon(
                        EvidenceTestFixtures.cp(1010f,
                                EvidenceTestFixtures.vehicle(1, 1001, 1, 4481, 0f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(2, 1002, 1, 4481, 50f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(3, 1003, 1, 4481, 500f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(4, 2001, 2, 10785, 80f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(5, 2002, 2, 10785, 300f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(6, 2003, 2, 10785, 400f, 0f, 1000)),
                        EvidenceTestFixtures.cp(1020f,
                                EvidenceTestFixtures.vehicle(1, 1001, 1, 4481, 0f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(2, 1002, 1, 4481, 50f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(3, 1003, 1, 4481, 500f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(4, 2001, 2, 10785, 50f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(5, 2002, 2, 10785, 60f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(6, 2003, 2, 10785, 80f, 0f, 1000))),
                features,
                EvidenceTestFixtures.recorder());

        final List<AiEvidence> evidence = new LocalSupportSkill().detect(ctx);
        assertEquals(1, evidence.size());
        final AiEvidence support = evidence.getFirst();
        assertEquals(1.0, support.numbers().get("nearbyFriendlyBefore"));
        assertEquals(1.0, support.numbers().get("nearbyFriendlyAfter"));
        assertEquals(1.0, support.numbers().get("nearbyEnemyBefore"));
        assertEquals(3.0, support.numbers().get("nearbyEnemyAfter"));
        assertEquals("1v1", support.labels().get("localNumbersBefore"));
        assertEquals("1v3", support.labels().get("localNumbersAfter"));
        assertEquals("GRID_REGION_5", support.labels().get("recorderRegion"));
        assertEquals(com.wotb.core.replay.event.DecodeConfidence.EXACT, support.confidence());
        assertTrue(support.summary().contains("局部支援变化"));
    }

    @Test
    void partiallyObservedEnemyChangeDoesNotProduceFlip() {
        final Battle battle = supportBattle();
        final PlayerBattleFeatureSet features = EvidenceTestFixtures.features(
                List.of(EvidenceTestFixtures.engagement(10f, 20f, 100, 100)));
        // cp1 只观察到 2/3 敌军，cp2 观察到 3/3：敌军数量变化可能只是点亮造成，不得产出翻转证据
        final EvidenceSkillContext ctx = new EvidenceSkillContext(
                battle,
                EvidenceTestFixtures.recon(
                        EvidenceTestFixtures.cp(1010f,
                                EvidenceTestFixtures.vehicle(1, 1001, 1, 4481, 0f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(2, 1002, 1, 4481, 50f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(3, 1003, 1, 4481, 500f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(4, 2001, 2, 10785, 80f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(5, 2002, 2, 10785, 90f, 0f, 1000)),
                        EvidenceTestFixtures.cp(1020f,
                                EvidenceTestFixtures.vehicle(1, 1001, 1, 4481, 0f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(2, 1002, 1, 4481, 50f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(3, 1003, 1, 4481, 500f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(4, 2001, 2, 10785, 50f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(5, 2002, 2, 10785, 60f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(6, 2003, 2, 10785, 80f, 0f, 1000))),
                features,
                EvidenceTestFixtures.recorder());
        assertTrue(new LocalSupportSkill().detect(ctx).isEmpty(),
                "敌军一侧未完整覆盖时，数量变化不得当作真实的支援结构变化");
    }

    @Test
    void ignoresStableSupport() {
        final Battle battle = supportBattle();
        final PlayerBattleFeatureSet features = EvidenceTestFixtures.features(
                List.of(EvidenceTestFixtures.engagement(10f, 20f, 100, 100)));
        final EvidenceSkillContext ctx = new EvidenceSkillContext(
                battle,
                EvidenceTestFixtures.recon(
                        EvidenceTestFixtures.cp(1010f,
                                EvidenceTestFixtures.vehicle(1, 1001, 1, 4481, 0f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(2, 1002, 1, 4481, 50f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(3, 1003, 1, 4481, 500f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(4, 2001, 2, 10785, 80f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(5, 2002, 2, 10785, 300f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(6, 2003, 2, 10785, 400f, 0f, 1000)),
                        EvidenceTestFixtures.cp(1020f,
                                EvidenceTestFixtures.vehicle(1, 1001, 1, 4481, 0f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(2, 1002, 1, 4481, 50f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(3, 1003, 1, 4481, 500f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(4, 2001, 2, 10785, 90f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(5, 2002, 2, 10785, 310f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(6, 2003, 2, 10785, 410f, 0f, 1000))),
                features,
                EvidenceTestFixtures.recorder());
        assertTrue(new LocalSupportSkill().detect(ctx).isEmpty());
    }
}
