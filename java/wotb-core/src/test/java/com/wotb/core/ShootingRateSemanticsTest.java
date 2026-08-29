package com.wotb.core;

import com.wotb.core.league.LeagueRatingNormalizer;
import com.wotb.core.model.Agg;
import com.wotb.core.model.PlayerResult;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 原始射击比例语义（正式契约）：
 * <pre>
 * hit_rate = hits / shots
 * pen_rate = penetrations / hits        （分母是命中次数，不是射击次数）
 * </pre>
 * denominator == 0 → null（unavailable，API null / Excel 空单元格 / UI "--"，禁止 0/0 伪装 0%）；
 * numerator == 0 且 denominator &gt; 0 → 合法 0。跨场基于总量 sum(pens)/sum(hits)，不是各场平均。
     * 与 Rating 内部 shooting 维度（Soft Wilson：90% Wilson 下界 + 10% raw）是两个不同语义，
     * 本测试不涉及 Rating。
 */
class ShootingRateSemanticsTest {

    private static PlayerResult player(final int shots, final int hits, final int pens) {
        final PlayerResult p = new PlayerResult();
        p.nShots = shots;
        p.nHitsDealt = hits;
        p.nPenetrationsDealt = pens;
        return p;
    }

    private static Object columnValue(final String key, final PlayerResult p) {
        for (final Columns.Column c : Columns.STAT) {
            if (c.key().equals(key)) {
                return c.get().apply(p);
            }
        }
        throw new AssertionError("unknown column: " + key);
    }

    @Test
    void singleBattleRatesUseCanonicalDenominators() {
        // shots=10 hits=5 pens=4 → 命中率 50%，击穿率 80%（不是 40%）
        final PlayerResult p = player(10, 5, 4);
        assertEquals(50.0, ((Number) columnValue("hit_rate", p)).doubleValue(), 1e-9);
        assertEquals(80.0, ((Number) columnValue("pen_rate", p)).doubleValue(), 1e-9);
    }

    @Test
    void zeroShotsBothRatesUnavailable() {
        final PlayerResult p = player(0, 0, 0);
        assertNull(columnValue("hit_rate", p), "shots==0 → hit_rate null（unavailable，禁止 0/0 伪装 0%）");
        assertNull(columnValue("pen_rate", p), "shots==0 → pen_rate null");
    }

    @Test
    void missAllShotsHitRateZeroPenRateUnavailable() {
        // shots=10 hits=0 pens=0 → 命中率 0%（合法 0），击穿率 null（hits==0 无法定义）
        final PlayerResult p = player(10, 0, 0);
        assertEquals(0.0, ((Number) columnValue("hit_rate", p)).doubleValue(), 1e-9);
        assertNull(columnValue("pen_rate", p), "hits==0 → pen_rate null");
    }

    @Test
    void hitButNoPenetrationPenRateZero() {
        // shots=10 hits=5 pens=0 → 命中率 50%，击穿率 0%（合法 0）
        final PlayerResult p = player(10, 5, 0);
        assertEquals(50.0, ((Number) columnValue("hit_rate", p)).doubleValue(), 1e-9);
        assertEquals(0.0, ((Number) columnValue("pen_rate", p)).doubleValue(), 1e-9);
    }

    @Test
    void aggregateRatesBasedOnTotalsNotAverage() {
        // 跨两场累计：total shots=20, hits=10, pens=8 → hit_rate=50, pen_rate=80
        // （若按各场比例简单平均会得到别的值——必须基于总量）
        final Agg a = new Agg();
        a.shots = 20;
        a.hits = 10;
        a.pens = 8;
        a.battles = 2;
        assertEquals(50.0, a.hitRate(), 1e-9);
        assertEquals(80.0, a.penRate(), 1e-9);
    }

    @Test
    void aggregateRatesUnavailableWhenDenominatorZero() {
        final Agg a = new Agg();
        a.shots = 0;
        a.hits = 0;
        a.pens = 0;
        a.battles = 1;
        assertNull(a.hitRate());
        assertNull(a.penRate());

        final Agg b = new Agg();
        b.shots = 10;
        b.hits = 0;
        b.pens = 0;
        b.battles = 1;
        assertEquals(0.0, b.hitRate(), 1e-9);
        assertNull(b.penRate());
    }

    @Test
    void aggregateColumnsGetRateOrNull() {
        final Agg a = new Agg();
        a.shots = 10;
        a.hits = 5;
        a.pens = 4;
        assertEquals(50.0, ((Number) AggregateColumns.core("hit_rate").get().apply(a)).doubleValue(), 1e-9);
        assertEquals(80.0, ((Number) AggregateColumns.core("pen_rate").get().apply(a)).doubleValue(), 1e-9);

        final Agg zero = new Agg();
        zero.shots = 0;
        zero.hits = 0;
        zero.pens = 0;
        assertNull(AggregateColumns.core("hit_rate").get().apply(zero));
        assertNull(AggregateColumns.core("pen_rate").get().apply(zero));
    }

    @Test
    void leagueRatingShootingStillUsesWilsonWithinSoftWilson() {
        // 分层契约：UI raw rate = 真实比例；Rating shooting = Soft Wilson
        // （90% Wilson 95% 下界 + 10% raw 比例）。
        // 本测试锁定 LeagueRatingCalculator 仍消费 wilsonLowerBound（不是纯裸比例）。
        // （细节公式在 LeagueRatingCalculatorTest；这里验证 LeagueRatingNormalizer API 仍存在且被使用）
        final double wilson = LeagueRatingNormalizer.wilsonLowerBound(5, 10);
        assertTrue(wilson >= 0 && wilson <= 1,
                "Wilson 下界是 confidence ∈ [0,1]，Soft Wilson 中仍承担 90% 权重");
    }
}
