package com.wotb.core.league;

/**
 * League Rating V6 batch projection（纯函数，无 Spring/DTO/DB/IO）。
 *
 * <p>Batch state is the raw sum and rated-battle count. The fixed symmetric
 * prior is applied exactly once when projecting a Player or Team Rating.</p>
 */
public final class LeagueBatchRatingCalculator {

    public static final double V6_ANCHOR = 475.0;
    public static final int PLAYER_PRIOR_WEIGHT = 5;
    public static final int TEAM_PRIOR_WEIGHT = 1;
    public static final double MAX_FINAL = PlayerLeagueRating.MAX_FINAL;

    private LeagueBatchRatingCalculator() {
    }

    /** Returns the observed arithmetic mean, or null when no rated battle exists. */
    public static Double observedMean(final double sum, final int ratedBattleCount) {
        validateAggregate(sum, ratedBattleCount);
        return ratedBattleCount == 0 ? null : sum / ratedBattleCount;
    }

    /** Projects the Player V6 Rating, or null when no rated battle exists. */
    public static Double playerRating(final double sum, final int ratedBattleCount) {
        return project(sum, ratedBattleCount, PLAYER_PRIOR_WEIGHT);
    }

    /** Projects the Team V6 Rating, or null when no rated battle exists. */
    public static Double teamRating(final double sum, final int ratedBattleCount) {
        return project(sum, ratedBattleCount, TEAM_PRIOR_WEIGHT);
    }

    /** Validates one unrounded V4.1 Final Rating before it enters batch state. */
    public static void requireObservation(final double rating) {
        if (!Double.isFinite(rating) || rating < 0.0 || rating > MAX_FINAL) {
            throw new IllegalArgumentException(
                    "V4.1 Final Rating must be finite and within [0, 1000], got " + rating);
        }
    }

    private static Double project(final double sum, final int ratedBattleCount,
                                  final int priorWeight) {
        validateAggregate(sum, ratedBattleCount);
        if (ratedBattleCount == 0) {
            return null;
        }
        final double projected = (sum + priorWeight * V6_ANCHOR)
                / (ratedBattleCount + priorWeight);
        if (!Double.isFinite(projected) || projected < 0.0 || projected > MAX_FINAL) {
            throw new IllegalStateException("V6 Rating projection is outside [0, 1000]: " + projected);
        }
        return projected;
    }

    private static void validateAggregate(final double sum, final int ratedBattleCount) {
        if (ratedBattleCount < 0) {
            throw new IllegalArgumentException(
                    "ratedBattleCount must not be negative, got " + ratedBattleCount);
        }
        if (!Double.isFinite(sum)) {
            throw new IllegalArgumentException("aggregate sum must be finite, got " + sum);
        }
        if (ratedBattleCount == 0) {
            if (sum != 0.0) {
                throw new IllegalArgumentException(
                        "empty aggregate must have sum 0, got " + sum);
            }
            return;
        }
        if (sum < 0.0 || sum > ratedBattleCount * MAX_FINAL) {
            throw new IllegalArgumentException(
                    "aggregate sum must be within [0, count * 1000], got " + sum);
        }
    }
}
