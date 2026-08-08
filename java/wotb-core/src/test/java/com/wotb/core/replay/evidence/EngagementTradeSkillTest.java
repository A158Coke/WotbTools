package com.wotb.core.replay.evidence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.model.Battle;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

class EngagementTradeSkillTest {

    @Test
    void reportsAliveCountsAroundEngagement() {
        final List<com.wotb.core.model.PlayerResult> players = new ArrayList<>();
        for (int i = 1; i <= 5; i++) {
            players.add(EvidenceTestFixtures.player(1000 + i, 1, 4481, "Kranvagn", true, 300));
        }
        for (int i = 1; i <= 5; i++) {
            players.add(EvidenceTestFixtures.player(2000 + i, 2, 10785, "T110E5", true, 300));
        }
        // 友军 1002 在 15s 阵亡
        players.set(1, EvidenceTestFixtures.player(1002, 1, 4481, "Kranvagn", false, 15));
        final Battle battle = EvidenceTestFixtures.battle(players);
        final PlayerBattleFeatureSet features = EvidenceTestFixtures.features(
                List.of(EvidenceTestFixtures.engagement(10f, 20f, 300, 100)));
        final EvidenceSkillContext ctx = new EvidenceSkillContext(
                battle, EvidenceTestFixtures.recon(), features, EvidenceTestFixtures.recorder());

        final List<AiEvidence> evidence = new EngagementTradeSkill().detect(ctx, List.of());
        assertEquals(1, evidence.size());
        final AiEvidence trade = evidence.getFirst();
        assertEquals(5.0, trade.numbers().get("friendlyAliveBefore"));
        assertEquals(4.0, trade.numbers().get("friendlyAliveAfter"));
        assertEquals(5.0, trade.numbers().get("enemyAliveAfter"));
        assertEquals("UNKNOWN", trade.labels().get("localNumbersBefore"));
        assertTrue(trade.summary().contains("换血"));
    }
}
