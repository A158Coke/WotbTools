package com.wotb.core.replay.facts;

import com.wotb.core.model.PlayerResult;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** TradeFacts 互换窗口 fail-closed 语义（死亡时间 UNKNOWN 不得推断 trade）。 */
class TradeFactsTest {

    private static PlayerResult player(final long accountId, final int team,
                                       final boolean survived, final double survivalTimeSec) {
        final PlayerResult p = new PlayerResult();
        p.accountId = accountId;
        p.team = team;
        p.survived = survived;
        p.survivalTimeSec = survivalTimeSec;
        return p;
    }

    @Test
    void unknownDeathTimeDoesNotInferTrade() {
        // A：阵亡 + survivalTimeSec == 0（死亡时间 UNKNOWN）；B：阵亡 + 已知死亡时间
        final PlayerResult a = player(1001L, 1, false, 0);
        final PlayerResult b = player(2001L, 2, false, 100);
        assertEquals(0, TradeFacts.tradedDeaths(a, List.of(a, b)),
                "无法建立 A 的可靠死亡窗口 → fail-closed 0，绝不推断 trade");
    }

    @Test
    void knownDeathWithinWindowCountsTrade() {
        // 既有行为回归：已知死亡时间 ±5s 窗口内存在敌方死亡 → trade 保持
        final PlayerResult a = player(1001L, 1, false, 100);
        final PlayerResult b = player(2001L, 2, false, 101);
        assertEquals(1, TradeFacts.tradedDeaths(a, List.of(a, b)));
    }

    @Test
    void survivorNeverCountsTrade() {
        final PlayerResult a = player(1001L, 1, true, 300);
        final PlayerResult b = player(2001L, 2, false, 100);
        assertEquals(0, TradeFacts.tradedDeaths(a, List.of(a, b)));
    }

    @Test
    void unknownEnemyDeathInsideWindowDoesNotCount() {
        // 敌方死亡时间 UNKNOWN（0）不得计入我方 trade 窗口
        final PlayerResult a = player(1001L, 1, false, 100);
        final PlayerResult b = player(2001L, 2, false, 0);
        assertEquals(0, TradeFacts.tradedDeaths(a, List.of(a, b)));
    }
}
