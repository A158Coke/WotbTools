package com.wotb.core.league;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** League Rating V5 Batch Player Evidence Adjustment。 */
class LeagueBatchPlayerRatingCalculatorTest {

    /** 期望 E(n)=1-exp(-n/6) 的精确值。 */
    private static double expectedEvidence(final int n) {
        return 1.0 - Math.exp(-n / LeagueBatchPlayerRatingCalculator.EVIDENCE_TIME_CONSTANT);
    }

    // ---- §29 Evidence 纯函数 ----

    @Test
    void evidenceMatchesClosedFormAcrossTypicalCounts() {
        for (final int n : new int[]{1, 2, 3, 5, 6, 9, 12, 18, 25, 100}) {
            assertEquals(expectedEvidence(n),
                    LeagueBatchPlayerRatingCalculator.evidence(n), 1e-12,
                    "E(" + n + ") 必须等于 1-exp(-n/6)");
        }
    }

    @Test
    void evidenceIsFiniteAndStrictlyIncreasingWithinUnitInterval() {
        double prev = 0;
        for (final int n : new int[]{1, 2, 3, 5, 6, 9, 12, 18, 25}) {
            final double e = LeagueBatchPlayerRatingCalculator.evidence(n);
            assertTrue(Double.isFinite(e), "E(n) 必须 finite");
            assertTrue(e > 0 && e < 1, "0 < E(n) < 1");
            assertTrue(e > prev, "E(n) 必须严格单调递增");
            prev = e;
        }
    }

    @Test
    void evidenceTendsToOneForLargeN() {
        final double e100 = LeagueBatchPlayerRatingCalculator.evidence(100);
        final double e1000 = LeagueBatchPlayerRatingCalculator.evidence(1000);
        assertTrue(e100 > 0.999999, "large n → E(n)→1");
        assertTrue(e1000 > e100, "继续单调递增");
        // n=1000 时 1-exp(-n/6) 在 double 精度下饱和为 1.0（数值收敛，非人工硬阈值）
        assertTrue(e1000 <= 1.0, "E(n)→1（数值饱和）");
    }

    @Test
    void evidenceRejectsNonPositiveCount() {
        assertThrows(IllegalArgumentException.class, () -> LeagueBatchPlayerRatingCalculator.evidence(0));
        assertThrows(IllegalArgumentException.class, () -> LeagueBatchPlayerRatingCalculator.evidence(-3));
    }

    // ---- §30 Anchor boundary ----

    @Test
    void rawAtOrBelowAnchorIsReturnedExactly() {
        for (final double raw : new double[]{0, 449.999, 450}) {
            assertEquals(raw, LeagueBatchPlayerRatingCalculator.apply(raw, 25), 1e-12,
                    "Raw<=450 完全不加分（单边）");
        }
    }

    @Test
    void rawJustAboveAnchorAppliesTinyEvidence() {
        final double raw = 450.001;
        final double v5 = LeagueBatchPlayerRatingCalculator.apply(raw, 1);
        assertTrue(v5 > 450, "Raw>450 才走 evidence adjustment（结果必须高于 anchor）");
        assertTrue(v5 < raw, "单边保守：V5 介于 anchor 与 raw 之间");
    }

    @Test
    void highRawClampedToOneThousand() {
        assertEquals(1000.0, LeagueBatchPlayerRatingCalculator.apply(1200, 18), 1e-9,
                "超过上限必须 clamp 到 1000");
    }

    // ---- §31 典型产品案例（Raw=900） ----

    @Test
    void productCasesRaw900() {
        final double raw = 900;
        assertEquals(519, Math.round(LeagueBatchPlayerRatingCalculator.apply(raw, 1)), "Case A n=1 ≈ 519");
        assertEquals(627, Math.round(LeagueBatchPlayerRatingCalculator.apply(raw, 3)), "Case B n=3 ≈ 627");
        assertEquals(704, Math.round(LeagueBatchPlayerRatingCalculator.apply(raw, 5)), "Case C n=5 ≈ 704");
        assertEquals(800, Math.round(LeagueBatchPlayerRatingCalculator.apply(raw, 9)), "Case D n=9 ≈ 800");
        assertEquals(839, Math.round(LeagueBatchPlayerRatingCalculator.apply(raw, 12)), "Case E n=12 ≈ 839");
        assertEquals(878, Math.round(LeagueBatchPlayerRatingCalculator.apply(raw, 18)), "Case F n=18 ≈ 878");
    }

    // ---- §32 低分不加分 ----

    @Test
    void lowRawNeverBoosted() {
        assertEquals(350.0, LeagueBatchPlayerRatingCalculator.apply(350, 1), 1e-12);
        assertEquals(449.0, LeagueBatchPlayerRatingCalculator.apply(449, 25), 1e-12);
    }

    // ---- 数值安全----

    @Test
    void rejectsNonPositiveCountAndNonFiniteRaw() {
        assertThrows(IllegalArgumentException.class, () -> LeagueBatchPlayerRatingCalculator.apply(500, 0));
        assertThrows(IllegalArgumentException.class, () -> LeagueBatchPlayerRatingCalculator.apply(Double.NaN, 5));
        assertThrows(IllegalArgumentException.class, () -> LeagueBatchPlayerRatingCalculator.apply(Double.POSITIVE_INFINITY, 5));
    }
}
