package com.wotb.core.replay.facts;

import com.wotb.core.model.Battle;
import com.wotb.core.model.PlayerResult;
import com.wotb.core.replay.evidence.EntryHpSource;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class BattleHpFactsTest {

    /** Kranvagn（4481，tankopedia base 2400，见 ObservedMaxHpTest）。 */
    private static final long KRANVAGN = 4481L;

    @Test
    void fourteenOfFourteenKnownReturnsCompleteAverage() {
        final Battle battle = battleWith(14, KRANVAGN);
        final BattleHpFacts.BattleAverageHp avg = BattleHpFacts.averageHp(battle);
        assertTrue(avg.complete());
        assertEquals(14.0 * 2400 / 14, avg.value(), 0.01);
    }

    @Test
    void thirteenKnownOneUnknownReturnsUnavailable() {
        final Battle battle = battleWith(13, KRANVAGN);
        // 第 14 名玩家 HP UNKNOWN（tankId=-1、无 entryHp）→ 整场 unavailable，禁止按 0 参与
        battle.players.add(player(999L, 1, -1));
        final BattleHpFacts.BattleAverageHp avg = BattleHpFacts.averageHp(battle);
        assertFalse(avg.complete(), "存在需计入平均值的 UNKNOWN 玩家时场均 HP 必须 unavailable");
        assertEquals(0.0, avg.value(), 0.01);
    }

    @Test
    void thirteenOfFourteenKnownAllHpReturnsUnavailable() {
        // 只有 13 名有效参战玩家（全 known）→ eligible=13 != 14，无权威均值
        final Battle battle = battleWith(13, KRANVAGN);
        final BattleHpFacts.BattleAverageHp avg = BattleHpFacts.averageHp(battle);
        assertFalse(avg.complete(), "不足 14 名参战玩家不得标记 complete");
        assertEquals(0.0, avg.value(), 0.01);
    }

    @Test
    void fourOfFourteenKnownAllHpReturnsUnavailable() {
        // 只有 4 名有效参战玩家（全 known）→ eligible=4 != 14，禁止 partial total / 14
        final Battle battle = battleWith(4, KRANVAGN);
        final BattleHpFacts.BattleAverageHp avg = BattleHpFacts.averageHp(battle);
        assertFalse(avg.complete(), "4 人 battle 不得得到虚假的 total/14 权威均值");
        assertEquals(0.0, avg.value(), 0.01);
    }

    @Test
    void zeroPlayersReturnsUnavailable() {
        final Battle battle = new Battle();
        battle.players = List.of();
        final BattleHpFacts.BattleAverageHp avg = BattleHpFacts.averageHp(battle);
        assertFalse(avg.complete());
        assertEquals(0.0, avg.value(), 0.01);
    }

    @Test
    void nullBattleOrPlayersReturnsUnavailable() {
        assertFalse(BattleHpFacts.averageHp(null).complete());
        final Battle battle = new Battle();
        battle.players = null;
        assertFalse(BattleHpFacts.averageHp(battle).complete());
    }

    @Test
    void unknownHpAmongFourteenReturnsUnavailable() {
        final Battle battle = battleWith(14, KRANVAGN);
        // 第 14 名玩家 HP UNKNOWN（tankId=-1、无 entryHp）→ 14 人但 1 unknown，禁止按 0 参与
        battle.players.set(13, player(999L, 1, -1));
        final BattleHpFacts.BattleAverageHp avg = BattleHpFacts.averageHp(battle);
        assertFalse(avg.complete(), "存在需计入平均值的 UNKNOWN 玩家时场均 HP 必须 unavailable");
        assertEquals(0.0, avg.value(), 0.01);
    }

    @Test
    void observedExactWinsOverTankopediaBase() {
        final List<PlayerResult> players = new ArrayList<>();
        for (int i = 0; i < 14; i++) {
            players.add(player(i + 1L, i % 2 == 0 ? 1 : 2, KRANVAGN));
        }
        players.getFirst().entryHpSource = EntryHpSource.OBSERVED_EXACT;
        players.getFirst().entryHp = 2600;
        final Battle battle = new Battle();
        battle.players = players;

        final BattleHpFacts.BattleAverageHp avg = BattleHpFacts.averageHp(battle);

        assertTrue(avg.complete());
        assertEquals((2600.0 + 13.0 * 2400) / 14, avg.value(), 0.01);
    }

    @Test
    void teamZeroPlayersAreExcludedFromCompleteness() {
        // 无队伍（team=0）的玩家不参与场均 HP（也不阻塞 complete）
        final Battle battle = battleWith(14, KRANVAGN);
        battle.players.add(player(1L, 0, -1));
        final BattleHpFacts.BattleAverageHp avg = BattleHpFacts.averageHp(battle);
        assertTrue(avg.complete(), "team=0 玩家不属于参战方，不影响 complete");
    }

    private static Battle battleWith(final int count, final long tankId) {
        final List<PlayerResult> players = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            players.add(player(i + 1L, i % 2 == 0 ? 1 : 2, tankId));
        }
        final Battle battle = new Battle();
        battle.players = players;
        return battle;
    }

    private static PlayerResult player(final long accountId, final int team, final long tankId) {
        final PlayerResult player = new PlayerResult();
        player.accountId = accountId;
        player.team = team;
        player.tankId = tankId;
        return player;
    }
}
