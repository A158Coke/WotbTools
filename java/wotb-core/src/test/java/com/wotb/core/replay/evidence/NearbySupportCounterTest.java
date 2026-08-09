package com.wotb.core.replay.evidence;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.event.DecodeConfidence;
import com.wotb.core.replay.reconstruction.BattleStateCheckpoint;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

class NearbySupportCounterTest {

    private static Battle battle(final int friendlies, final int enemies) {
        final List<PlayerResult> players = new ArrayList<>();
        for (int i = 1; i <= friendlies; i++) {
            players.add(EvidenceTestFixtures.player(1000 + i, 1, 4481, "Kranvagn", true, 300));
        }
        for (int i = 1; i <= enemies; i++) {
            players.add(EvidenceTestFixtures.player(2000 + i, 2, 10785, "T110E5", true, 300));
        }
        return EvidenceTestFixtures.battle(players);
    }

    @Test
    void fullCoverageIsExactWithCompleteNumbers() {
        final Battle battle = battle(2, 3);
        final BattleStateCheckpoint cp = EvidenceTestFixtures.cp(1010f,
                EvidenceTestFixtures.vehicle(1, 1001, 1, 4481, 0f, 0f, 1000),
                EvidenceTestFixtures.vehicle(2, 1002, 1, 4481, 50f, 0f, 1000),
                EvidenceTestFixtures.vehicle(3, 2001, 2, 10785, 80f, 0f, 1000),
                EvidenceTestFixtures.vehicle(4, 2002, 2, 10785, 90f, 0f, 1000),
                EvidenceTestFixtures.vehicle(5, 2003, 2, 10785, 300f, 0f, 1000));
        final NearbySupportCounter.Counts counts = NearbySupportCounter.at(
                List.of(cp), 1000f, 10f, 1, battle);
        assertNotNull(counts);
        assertEquals(DecodeConfidence.EXACT, counts.confidence());
        assertEquals(1, counts.friendlyCount());
        assertEquals(2, counts.enemyCount());
        assertEquals("1v2", counts.numbersLabel());
        assertTrue(counts.friendlyFullyObserved());
        assertTrue(counts.enemyFullyObserved());
    }

    @Test
    void partialEnemyCoverageIsNeverExactAndUsesAtLeastSemantics() {
        final Battle battle = battle(2, 3);
        final BattleStateCheckpoint cp = EvidenceTestFixtures.cp(1010f,
                EvidenceTestFixtures.vehicle(1, 1001, 1, 4481, 0f, 0f, 1000),
                EvidenceTestFixtures.vehicle(2, 1002, 1, 4481, 50f, 0f, 1000),
                EvidenceTestFixtures.vehicle(3, 2001, 2, 10785, 80f, 0f, 1000),
                EvidenceTestFixtures.vehicle(4, 2002, 2, 10785, 90f, 0f, 1000));
        // 3 名敌军只观察到 2 名：不得标 EXACT，数量必须表达为"至少 N"
        final NearbySupportCounter.Counts counts = NearbySupportCounter.at(
                List.of(cp), 1000f, 10f, 1, battle);
        assertNotNull(counts);
        assertEquals(DecodeConfidence.PARTIAL, counts.confidence());
        assertFalse(counts.enemyFullyObserved());
        assertEquals(2, counts.enemyCount());
        assertEquals("≥2", counts.enemyLabel());
        assertEquals("1v≥2", counts.numbersLabel());
    }

    @Test
    void unseenEnemyIsNotCountedAsAbsent() {
        final Battle battle = battle(2, 3);
        final BattleStateCheckpoint cp = EvidenceTestFixtures.cp(1010f,
                EvidenceTestFixtures.vehicle(1, 1001, 1, 4481, 0f, 0f, 1000),
                EvidenceTestFixtures.vehicle(2, 1002, 1, 4481, 50f, 0f, 1000),
                EvidenceTestFixtures.vehicle(3, 2001, 2, 10785, 80f, 0f, 1000));
        final NearbySupportCounter.Counts counts = NearbySupportCounter.at(
                List.of(cp), 1000f, 10f, 1, battle);
        assertNotNull(counts);
        assertEquals(1, counts.enemyCount());
        // 还有 2 名敌军完全未被观察到：不能表达成"附近只有 1 名敌军"
        assertEquals("≥1", counts.enemyLabel());
        assertEquals("1v≥1", counts.numbersLabel());
    }

    @Test
    void deadEnemyIsRemovedFromAliveDenominator() {
        final List<PlayerResult> players = new ArrayList<>();
        players.add(EvidenceTestFixtures.player(1001, 1, 4481, "Kranvagn", true, 300));
        players.add(EvidenceTestFixtures.player(1002, 1, 4481, "Kranvagn", true, 300));
        players.add(EvidenceTestFixtures.player(2001, 2, 10785, "T110E5", false, 100));
        players.add(EvidenceTestFixtures.player(2002, 2, 10785, "T110E5", true, 300));
        players.add(EvidenceTestFixtures.player(2003, 2, 10785, "T110E5", true, 300));
        final Battle battle = EvidenceTestFixtures.battle(players);
        // 查询 120s：2001 已在 100s 阵亡，不进入 denominator；其余存活敌人全部 observed
        final BattleStateCheckpoint cp = EvidenceTestFixtures.cp(1120f,
                EvidenceTestFixtures.vehicle(1, 1001, 1, 4481, 0f, 0f, 1000),
                EvidenceTestFixtures.vehicle(2, 1002, 1, 4481, 50f, 0f, 1000),
                EvidenceTestFixtures.vehicle(3, 2002, 2, 10785, 80f, 0f, 1000),
                EvidenceTestFixtures.vehicle(4, 2003, 2, 10785, 90f, 0f, 1000));
        final NearbySupportCounter.Counts counts = NearbySupportCounter.at(
                List.of(cp), 1000f, 120f, 1, battle);
        assertNotNull(counts);
        assertEquals(2, counts.enemyTotal(), "阵亡敌车不得留在 denominator");
        assertEquals(2, counts.observedEnemyTotal());
        assertTrue(counts.enemyFullyObserved(),
                "存活敌军全部被观察时应重新得到 enemyFullyObserved=true");
        assertEquals(DecodeConfidence.EXACT, counts.confidence());
    }

    @Test
    void aliveButUnobservedEnemyKeepsPartialSemantics() {
        final List<PlayerResult> players = new ArrayList<>();
        players.add(EvidenceTestFixtures.player(1001, 1, 4481, "Kranvagn", true, 300));
        players.add(EvidenceTestFixtures.player(1002, 1, 4481, "Kranvagn", true, 300));
        for (int i = 1; i <= 6; i++) {
            players.add(EvidenceTestFixtures.player(2000 + i, 2, 10785, "T110E5", true, 300));
        }
        final Battle battle = EvidenceTestFixtures.battle(players);
        final BattleStateCheckpoint cp = EvidenceTestFixtures.cp(1010f,
                EvidenceTestFixtures.vehicle(1, 1001, 1, 4481, 0f, 0f, 1000),
                EvidenceTestFixtures.vehicle(2, 1002, 1, 4481, 50f, 0f, 1000),
                EvidenceTestFixtures.vehicle(3, 2001, 2, 10785, 80f, 0f, 1000),
                EvidenceTestFixtures.vehicle(4, 2002, 2, 10785, 90f, 0f, 1000),
                EvidenceTestFixtures.vehicle(5, 2003, 2, 10785, 95f, 0f, 1000),
                EvidenceTestFixtures.vehicle(6, 2004, 2, 10785, 100f, 0f, 1000),
                EvidenceTestFixtures.vehicle(7, 2005, 2, 10785, 110f, 0f, 1000));
        // 6 名存活敌军，只观察到 5 名（2006 未点亮）
        final NearbySupportCounter.Counts counts = NearbySupportCounter.at(
                List.of(cp), 1000f, 10f, 1, battle);
        assertNotNull(counts);
        assertEquals(6, counts.enemyTotal());
        assertEquals(5, counts.observedEnemyTotal());
        assertFalse(counts.enemyFullyObserved());
        assertEquals("≥5", counts.enemyLabel());
        assertEquals(DecodeConfidence.PARTIAL, counts.confidence());
    }
}
