package com.wotb.core.replay.evidence;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.reconstruction.Vector3;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RouteSkillTest {

    private static Battle routeBattle() {
        final List<PlayerResult> players = new ArrayList<>();
        players.add(EvidenceTestFixtures.player(1001, 1, 4481, "Kranvagn", true, 300));
        players.add(EvidenceTestFixtures.player(1002, 1, 4481, "Kranvagn", true, 300));
        players.add(EvidenceTestFixtures.player(1003, 1, 4481, "Kranvagn", true, 300));
        players.add(EvidenceTestFixtures.player(2001, 2, 10785, "T110E5", true, 300));
        players.add(EvidenceTestFixtures.player(2002, 2, 10785, "T110E5", true, 300));
        return EvidenceTestFixtures.battle(players);
    }

    @Test
    void openingRouteCollapsesRegionSequence() {
        final PlayerBattleFeatureSet features = new PlayerBattleFeatureSet(
                List.of(
                        EvidenceTestFixtures.movement(0f, 10f, new Vector3(10, 0, 0), new Vector3(100, 0, 0)),
                        EvidenceTestFixtures.movement(10f, 30f, new Vector3(100, 0, 0), new Vector3(200, 0, 0))),
                List.of(), List.of(), List.of(), List.of(), true);
        final EvidenceSkillContext ctx = new EvidenceSkillContext(
                routeBattle(), EvidenceTestFixtures.recon(), features, EvidenceTestFixtures.recorder());
        final List<AiEvidence> opening = RouteSkill.openingRoute(ctx);
        assertEquals(1, opening.size());
        assertEquals("5→6", opening.getFirst().labels().get("route"));
    }

    @Test
    void detectsDetachmentFromFriendlyCentroid() {
        final PlayerBattleFeatureSet features = new PlayerBattleFeatureSet(
                List.of(), List.of(), List.of(), List.of(), List.of(), true);
        final EvidenceSkillContext ctx = new EvidenceSkillContext(
                routeBattle(),
                EvidenceTestFixtures.recon(
                        EvidenceTestFixtures.cp(1000f,
                                EvidenceTestFixtures.vehicle(1, 1001, 1, 4481, 0f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(2, 1002, 1, 4481, 200f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(3, 1003, 1, 4481, 220f, 50f, 1000)),
                        EvidenceTestFixtures.cp(1010f,
                                EvidenceTestFixtures.vehicle(1, 1001, 1, 4481, 0f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(2, 1002, 1, 4481, 200f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(3, 1003, 1, 4481, 220f, 50f, 1000)),
                        EvidenceTestFixtures.cp(1020f,
                                EvidenceTestFixtures.vehicle(1, 1001, 1, 4481, 0f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(2, 1002, 1, 4481, 200f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(3, 1003, 1, 4481, 220f, 50f, 1000)),
                        EvidenceTestFixtures.cp(1030f,
                                EvidenceTestFixtures.vehicle(1, 1001, 1, 4481, 0f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(2, 1002, 1, 4481, 200f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(3, 1003, 1, 4481, 220f, 50f, 1000))),
                features,
                EvidenceTestFixtures.recorder());
        final List<AiEvidence> separations = RouteSkill.separationWindows(ctx);
        assertEquals(1, separations.size());
        assertEquals(0f, separations.getFirst().startSec());
        assertEquals(30f, separations.getFirst().endSec());
        assertTrue(separations.getFirst().summary().contains("空间分离"),
                "summary 必须是中性空间分离表述: " + separations.getFirst().summary());
    }

    @Test
    void reportsLocalObservedNumbersOnEntry() {
        final PlayerBattleFeatureSet features = new PlayerBattleFeatureSet(
                List.of(EvidenceTestFixtures.movement(0f, 10f, new Vector3(0, 0, 0), new Vector3(50, 0, 0))),
                List.of(), List.of(), List.of(), List.of(), true);
        // 友军侧完整覆盖（1002/1003 都被观察到，但远离录像者），observedEnemy=2 是真实敌军下界
        final EvidenceSkillContext ctx = new EvidenceSkillContext(
                routeBattle(),
                EvidenceTestFixtures.recon(
                        EvidenceTestFixtures.cp(1000f,
                                EvidenceTestFixtures.vehicle(1, 1001, 1, 4481, 0f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(2, 1002, 1, 4481, 500f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(3, 1003, 1, 4481, 550f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(4, 2001, 2, 10785, 50f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(5, 2002, 2, 10785, 60f, 0f, 1000)),
                        EvidenceTestFixtures.cp(1010f,
                                EvidenceTestFixtures.vehicle(1, 1001, 1, 4481, 50f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(2, 1002, 1, 4481, 500f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(3, 1003, 1, 4481, 550f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(4, 2001, 2, 10785, 90f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(5, 2002, 2, 10785, 100f, 0f, 1000))),
                features,
                EvidenceTestFixtures.recorder());
        final List<AiEvidence> entries = RouteSkill.localObservedNumbersEntries(ctx);
        assertEquals(1, entries.size());
        // 只报数量事实，不得声称「敌方人数优势」（战术判断由 LLM 负责）
        assertTrue(entries.getFirst().summary().contains("观察到附近友军"),
                "summary 必须只报观察数量: " + entries.getFirst().summary());
        assertTrue(entries.getFirst().summary().contains("敌军至少"),
                "summary 必须用「至少观察到 N 辆敌军」口径: " + entries.getFirst().summary());
        assertFalse(entries.getFirst().summary().contains("人数优势"),
                "不得输出「敌方人数优势」战术结论: " + entries.getFirst().summary());
    }

    @Test
    void friendlyPartialCoverageNeverReportsLocalNumbers() {
        final PlayerBattleFeatureSet features = new PlayerBattleFeatureSet(
                List.of(EvidenceTestFixtures.movement(0f, 10f, new Vector3(0, 0, 0), new Vector3(50, 0, 0))),
                List.of(), List.of(), List.of(), List.of(), true);
        // 友军侧只观察到 0/2（1002/1003 未点亮），即使观察到 2 名敌军也不能声称"敌方人数优势"
        final EvidenceSkillContext ctx = new EvidenceSkillContext(
                routeBattle(),
                EvidenceTestFixtures.recon(
                        EvidenceTestFixtures.cp(1000f,
                                EvidenceTestFixtures.vehicle(1, 1001, 1, 4481, 0f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(4, 2001, 2, 10785, 50f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(5, 2002, 2, 10785, 60f, 0f, 1000)),
                        EvidenceTestFixtures.cp(1010f,
                                EvidenceTestFixtures.vehicle(1, 1001, 1, 4481, 50f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(4, 2001, 2, 10785, 90f, 0f, 1000),
                                EvidenceTestFixtures.vehicle(5, 2002, 2, 10785, 100f, 0f, 1000))),
                features,
                EvidenceTestFixtures.recorder());
        assertTrue(RouteSkill.localObservedNumbersEntries(ctx).isEmpty(),
                "友军侧未完整覆盖时不得输出局部数量（敌军数量非真实下界）");
    }
}
