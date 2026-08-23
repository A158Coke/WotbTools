package com.wotb.core.league;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** 归一化纯函数测试：T(x) / G(x) / Wilson 下界。 */
class LeagueRatingNormalizerTest {

    // ---- T(x) 本队贡献指数 ----

    @Test
    void teamIndexZeroForNonPositiveInputs() {
        assertEquals(0, LeagueRatingNormalizer.teamIndex(0, 1000), 1e-9);
        assertEquals(0, LeagueRatingNormalizer.teamIndex(-5, 1000), 1e-9);
        assertEquals(0, LeagueRatingNormalizer.teamIndex(500, 0), 1e-9);
        assertEquals(0, LeagueRatingNormalizer.teamIndex(Double.NaN, 1000), 1e-9);
        assertEquals(0, LeagueRatingNormalizer.teamIndex(500, Double.POSITIVE_INFINITY), 1e-9);
    }

    @Test
    void teamIndexAtTeamAverageIsHalf() {
        // 本队平均贡献对应 0.5
        assertEquals(0.5, LeagueRatingNormalizer.teamIndex(1000, 1000), 1e-9);
    }

    @Test
    void teamIndexAtTwiceAverageIsCapped() {
        assertEquals(1.0, LeagueRatingNormalizer.teamIndex(2000, 1000), 1e-9);
        assertEquals(1.0, LeagueRatingNormalizer.teamIndex(99999, 1000), 1e-9);
    }

    @Test
    void teamIndexBelowAverageIsLinear() {
        assertEquals(0.25, LeagueRatingNormalizer.teamIndex(500, 1000), 1e-9);
    }

    // ---- G(x) 全场排名指数 ----

    @Test
    void globalIndexUniqueFirstAndLast() {
        final List<Double> all = List.of(1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0,
                8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0);
        assertEquals(1.0, LeagueRatingNormalizer.globalIndex(14.0, all), 1e-9);
        assertEquals(0.0, LeagueRatingNormalizer.globalIndex(1.0, all), 1e-9);
    }

    @Test
    void globalIndexTiesShareAverageRank() {
        // 两个并列第一：共享名次 1.5 → (14-1.5)/13 = 12.5/13
        final List<Double> all = List.of(10.0, 10.0, 1.0, 1.0, 1.0, 1.0, 1.0,
                1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0);
        final double expected = (14 - 1.5) / 13.0;
        assertEquals(expected, LeagueRatingNormalizer.globalIndex(10.0, all), 1e-9);
    }

    @Test
    void globalIndexAllZeroMeansZero() {
        final List<Double> all = List.of(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
                0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        assertEquals(0, LeagueRatingNormalizer.globalIndex(0.0, all), 1e-9);
        // 输入 0 直接得 0，即使全零列表
        assertEquals(0, LeagueRatingNormalizer.globalIndex(0.0, all), 1e-9);
    }

    @Test
    void globalIndexIgnoresNonPositiveValues() {
        // 只有 7 个正值 → 6 个比 10 小，10 是唯一第一（在正值集合内）
        final List<Double> all = List.of(10.0, 5.0, 4.0, 3.0, 2.0, 1.0, 0.0,
                0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        assertEquals(1.0, LeagueRatingNormalizer.globalIndex(10.0, all), 1e-9);
    }

    // ---- Wilson lower bound ----

    @Test
    void wilsonZeroTrialsIsZero() {
        assertEquals(0, LeagueRatingNormalizer.wilsonLowerBound(0, 0), 1e-9);
        assertEquals(0, LeagueRatingNormalizer.wilsonLowerBound(5, 0), 1e-9);
    }

    @Test
    void wilsonOneOfOneIsNotNearFull() {
        // 1/1 的 95% 下界约 0.206（远低于 1.0）
        final double lb = LeagueRatingNormalizer.wilsonLowerBound(1, 1);
        assertTrue(lb < 0.35, "1/1 Wilson lower bound should be small, got " + lb);
        assertTrue(lb > 0.05);
    }

    @Test
    void wilsonManyHighEfficiencyApproachesFull() {
        // 100/100 → 下界接近 0.96+
        final double lb = LeagueRatingNormalizer.wilsonLowerBound(100, 100);
        assertTrue(lb > 0.95, "100/100 lower bound should be near 1, got " + lb);
    }

    @Test
    void wilsonZeroSuccessIsZero() {
        assertEquals(0, LeagueRatingNormalizer.wilsonLowerBound(0, 10), 1e-9);
    }
}
