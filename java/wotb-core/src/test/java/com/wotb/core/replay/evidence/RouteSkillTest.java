package com.wotb.core.replay.evidence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.feature.PlayerBattleFeatureSet;
import com.wotb.core.replay.reconstruction.Vector3;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

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
        final List<AiEvidence> detachments = RouteSkill.detachmentWindows(ctx);
        assertEquals(1, detachments.size());
        assertEquals(0f, detachments.getFirst().startSec());
        assertEquals(30f, detachments.getFirst().endSec());
    }

    @Test
    void flagsEntryIntoEnemyMajorityArea() {
        final PlayerBattleFeatureSet features = new PlayerBattleFeatureSet(
                List.of(EvidenceTestFixtures.movement(0f, 10f, new Vector3(0, 0, 0), new Vector3(50, 0, 0))),
                List.of(), List.of(), List.of(), List.of(), true);
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
        final List<AiEvidence> entries = RouteSkill.enemyMajorityEntries(ctx);
        assertEquals(1, entries.size());
        assertTrue(entries.getFirst().summary().contains("敌方人数优势"));
    }
}
