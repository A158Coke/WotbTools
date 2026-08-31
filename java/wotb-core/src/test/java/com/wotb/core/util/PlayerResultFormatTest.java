package com.wotb.core.util;

import com.wotb.core.model.Battle;
import com.wotb.core.model.DeathTimeSource;
import com.wotb.core.model.PlayerResult;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * {@link PlayerResultFormat#deathSec} 严格 settlement 入口回归（P0-2）：
 * SETTLEMENT_SECOND → deathTimeMillis；UNKNOWN/null source 或 live-only projection → 0。
 * <b>禁止</b>裸 survivalTimeSec / deathTimeMillis 把 UNKNOWN 偷渡成 KNOWN。
 */
class PlayerResultFormatTest {

    private static PlayerResult dead(final DeathTimeSource source, final double survivalSec,
                                     final long deathMillis) {
        final PlayerResult p = new PlayerResult();
        p.survived = false;
        p.survivalTimeSec = survivalSec;
        p.deathTimeMillis = deathMillis;
        p.deathTimeSource = source;
        return p;
    }

    @Test
    void liveExactRequiresBattleObservation() {
        final PlayerResult p = dead(DeathTimeSource.LIVE_EXACT, 42.5, 0);
        final Battle battle = new Battle();
        battle.players = java.util.List.of(p);
        battle.liveDeathObservations = java.util.Map.of(
                p.accountId,
                new com.wotb.core.model.DeathTimeObservation(DeathTimeSource.LIVE_EXACT, 42.5));
        assertEquals(42.5, PlayerResultFormat.deathSec(battle, p), 1e-9);
        assertEquals(0.0, PlayerResultFormat.deathSec(p), 1e-9,
                "单参数 settlement 入口不得读取 live projection");
    }

    @Test
    void settlementSecondUsesDeathTimeMillis() {
        assertEquals(128.12, PlayerResultFormat.deathSec(
                dead(DeathTimeSource.SETTLEMENT_SECOND, 0, 128_120)), 1e-9);
    }

    @Test
    void unknownSourceIsZeroEvenWithSurvivalAndMillis() {
        // P0-2 核心回归：source 为 UNKNOWN/null 时，即使残留 survivalTimeSec/deathTimeMillis
        // 也绝不能被偷渡成 KNOWN 死亡时刻。
        assertEquals(0, PlayerResultFormat.deathSec(dead(DeathTimeSource.UNKNOWN, 42.0, 42_000)));
        final PlayerResult noSource = dead(null, 42.0, 42_000);
        assertEquals(0, PlayerResultFormat.deathSec(noSource),
                "null source 且残留旧字段不得被当作 KNOWN");
    }

    @Test
    void survivorIsAlwaysZero() {
        final PlayerResult p = dead(DeathTimeSource.SETTLEMENT_SECOND, 300.0, 300_000);
        p.survived = true;
        assertEquals(0, PlayerResultFormat.deathSec(p), "存活玩家无死亡时刻");
    }

    @Test
    void nullPlayerIsZero() {
        assertEquals(0, PlayerResultFormat.deathSec(null));
    }
}
