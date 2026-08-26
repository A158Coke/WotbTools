package com.wotb.core.replay.facts;

import com.wotb.core.model.PlayerResult;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

/** TradeFacts V4.1 directional 互换窗口 fail-closed 语义（[0, +5s] 边界包含；死亡时间 UNKNOWN 不得推断 trade）。 */
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
        // 玩家死亡后 0..+5s 内存在敌方死亡 → trade 保持
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

    @Test
    void sameTeamDeathDoesNotCountTrade() {
        // 同队死亡（即使时间在窗口内）不计 trade
        final PlayerResult a = player(1001L, 1, false, 100);
        final PlayerResult b = player(1002L, 1, false, 101);
        assertEquals(0, TradeFacts.tradedDeaths(a, List.of(a, b)));
    }

    @Test
    void enemySurvivedDoesNotCountTrade() {
        final PlayerResult a = player(1001L, 1, false, 100);
        final PlayerResult b = player(2001L, 2, true, 300);
        assertEquals(0, TradeFacts.tradedDeaths(a, List.of(a, b)));
    }

    @Test
    void multipleEnemiesInWindowAllCount() {
        // 窗口内多名敌方死亡都计入 tradedDeaths（Calculator RC 只给 50，不叠加）
        final PlayerResult a = player(1001L, 1, false, 100);
        final PlayerResult b = player(2001L, 2, false, 101);
        final PlayerResult c = player(2002L, 2, false, 104);
        assertEquals(2, TradeFacts.tradedDeaths(a, List.of(a, b, c)));
    }

    // ---- directional 0..+5s 窗口边界（正式语义，边界包含）----

    @Test
    void enemyDeathBeforePlayerIsNotTrade() {
        // 敌方在玩家死亡之前阵亡 → 不是 directional trade
        for (final double enemyDeath : new double[]{90.0, 99.999}) {
            final PlayerResult a = player(1001L, 1, false, 100);
            final PlayerResult b = player(2001L, 2, false, enemyDeath);
            assertEquals(0, TradeFacts.tradedDeaths(a, List.of(a, b)),
                    "T=100, enemy=" + enemyDeath + " 早于玩家死亡 → 不计 directional trade");
        }
    }

    @Test
    void tradeWindowBoundaryInclusiveFromSameTimestampToPlusFiveSeconds() {
        // 玩家死亡时刻 T=100：enemy ∈ [100.0, 105.0]（边界包含）都算 trade
        for (final double enemyDeath : new double[]{100.0, 100.001, 102.5, 104.999, 105.0}) {
            final PlayerResult a = player(1001L, 1, false, 100);
            final PlayerResult b = player(2001L, 2, false, enemyDeath);
            assertEquals(1, TradeFacts.tradedDeaths(a, List.of(a, b)),
                    "T=100, enemy=" + enemyDeath + " 应在 [0,+5s] 窗口内（边界包含）");
        }
    }

    @Test
    void tradeWindowBoundaryExclusiveBeyondFiveSeconds() {
        // 超出 +5.0 → no trade（含原 ±10 时代算 trade 的 6s/10s 差值）
        for (final double enemyDeath : new double[]{105.001, 106.0, 110.0}) {
            final PlayerResult a = player(1001L, 1, false, 100);
            final PlayerResult b = player(2001L, 2, false, enemyDeath);
            assertEquals(0, TradeFacts.tradedDeaths(a, List.of(a, b)),
                    "T=100, enemy=" + enemyDeath + " 超出 +5s 窗口 → 不计");
        }
    }
}
