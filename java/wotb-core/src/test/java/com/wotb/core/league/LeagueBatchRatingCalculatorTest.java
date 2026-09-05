package com.wotb.core.league;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/** League Rating V6 sum/count projection. */
class LeagueBatchRatingCalculatorTest {

    @Test
    void playerFormulaUsesSymmetricPrior() {
        assertEquals((900.0 + 2375.0) / 6.0,
                LeagueBatchRatingCalculator.playerRating(900.0, 1), 1e-12);
        assertEquals((180.0 + 2375.0) / 6.0,
                LeagueBatchRatingCalculator.playerRating(180.0, 1), 1e-12);
        assertEquals((100.0 + 300.0 + 500.0 + 700.0 + 900.0 + 2375.0) / 10.0,
                LeagueBatchRatingCalculator.playerRating(2500.0, 5), 1e-12);
        assertEquals((25 * 600.0 + 2375.0) / 30.0,
                LeagueBatchRatingCalculator.playerRating(25 * 600.0, 25), 1e-12);
    }

    @Test
    void teamFormulaUsesOneSharedAnchorPrior() {
        assertEquals((900.0 + 475.0) / 2.0,
                LeagueBatchRatingCalculator.teamRating(900.0, 1), 1e-12);
        assertEquals((900.0 + 300.0 + 475.0) / 3.0,
                LeagueBatchRatingCalculator.teamRating(1200.0, 2), 1e-12);
        assertEquals((10 * 600.0 + 475.0) / 11.0,
                LeagueBatchRatingCalculator.teamRating(6000.0, 10), 1e-12);
    }

    @Test
    void zeroBattleAggregateIsUnavailable() {
        assertNull(LeagueBatchRatingCalculator.observedMean(0.0, 0));
        assertNull(LeagueBatchRatingCalculator.playerRating(0.0, 0));
        assertNull(LeagueBatchRatingCalculator.teamRating(0.0, 0));
    }

    @Test
    void observedMeanUsesRawSumAndCount() {
        assertEquals(500.0, LeagueBatchRatingCalculator.observedMean(1500.0, 3), 1e-12);
    }

    @Test
    void everyLegalNextObservationChangesProjectionUnlessEqual() {
        final double sum = 900.0;
        final int count = 1;
        final double current = LeagueBatchRatingCalculator.playerRating(sum, count);
        final double equal = LeagueBatchRatingCalculator.playerRating(sum + current, count + 1);
        assertEquals(current, equal, 1e-12);
        final double low = LeagueBatchRatingCalculator.playerRating(sum + 100.0, count + 1);
        final double high = LeagueBatchRatingCalculator.playerRating(sum + 900.0, count + 1);
        assertTrue(low < current);
        assertTrue(high > current);
        assertTrue(low != high);
    }

    @Test
    void mergeRawStatesThenProjectsOnce() {
        final double all = LeagueBatchRatingCalculator.playerRating(100 + 300 + 500 + 700 + 900, 5);
        final double merged = LeagueBatchRatingCalculator.playerRating(
                (100 + 300) + (500 + 700 + 900), 2 + 3);
        assertEquals(all, merged, 1e-12);
    }

    @Test
    void rejectsInvalidAggregateNumbers() {
        assertThrows(IllegalArgumentException.class,
                () -> LeagueBatchRatingCalculator.playerRating(Double.NaN, 1));
        assertThrows(IllegalArgumentException.class,
                () -> LeagueBatchRatingCalculator.playerRating(Double.POSITIVE_INFINITY, 1));
        assertThrows(IllegalArgumentException.class,
                () -> LeagueBatchRatingCalculator.playerRating(-1.0, 1));
        assertThrows(IllegalArgumentException.class,
                () -> LeagueBatchRatingCalculator.playerRating(1000.0001, 1));
        assertThrows(IllegalArgumentException.class,
                () -> LeagueBatchRatingCalculator.playerRating(0.0, -1));
        assertThrows(IllegalArgumentException.class,
                () -> LeagueBatchRatingCalculator.playerRating(1.0, 0));
    }

    @Test
    void rejectsInvalidSingleObservationNumbers() {
        assertThrows(IllegalArgumentException.class,
                () -> LeagueBatchRatingCalculator.requireObservation(Double.NaN));
        assertThrows(IllegalArgumentException.class,
                () -> LeagueBatchRatingCalculator.requireObservation(Double.POSITIVE_INFINITY));
        assertThrows(IllegalArgumentException.class,
                () -> LeagueBatchRatingCalculator.requireObservation(-1.0));
        assertThrows(IllegalArgumentException.class,
                () -> LeagueBatchRatingCalculator.requireObservation(1000.0001));
        LeagueBatchRatingCalculator.requireObservation(0.0);
        LeagueBatchRatingCalculator.requireObservation(1000.0);
    }
}
