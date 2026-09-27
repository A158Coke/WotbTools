//! League Rating V6 batch projection.
//!
//! Ports `com.wotb.core.league.LeagueBatchRatingCalculator`: batch state is the raw unrounded sum
//! plus the rated-battle count, and the fixed symmetric prior (`A = 475`) is applied exactly once at
//! projection time. No median, no evidence curve, no per-battle average-of-ratios.

use thiserror::Error;

/// Fixed symmetric prior anchor.
pub const V6_ANCHOR: f64 = 475.0;
/// Player prior weight.
pub const PLAYER_PRIOR_WEIGHT: i64 = 5;
/// Team prior weight.
pub const TEAM_PRIOR_WEIGHT: i64 = 1;

#[derive(Debug, Error, PartialEq)]
pub enum BatchRatingError {
    #[error("ratedBattleCount must not be negative, got {0}")]
    NegativeBattleCount(i64),
    #[error("aggregate sum must be finite, got {0}")]
    NonFiniteSum(f64),
    #[error("empty aggregate must have sum 0, got {0}")]
    EmptyAggregateWithSum(f64),
    #[error("aggregate sum must be within [0, count * 1000], got {0}")]
    SumOutOfRange(f64),
    #[error("V4.1 Final Rating must be finite and within [0, 1000], got {0}")]
    ObservationOutOfRange(f64),
    #[error("V6 Rating projection is outside [0, 1000]: {0}")]
    ProjectionOutOfRange(f64),
}

/// Observed arithmetic mean; `None` when nothing was rated.
pub fn observed_mean(sum: f64, rated_battle_count: i64) -> Result<Option<f64>, BatchRatingError> {
    validate_aggregate(sum, rated_battle_count)?;
    if rated_battle_count == 0 {
        return Ok(None);
    }
    Ok(Some(sum / rated_battle_count as f64))
}

/// V6 player rating (`(sum + 5 × 475) / (count + 5)`); `None` when nothing was rated.
pub fn player_batch_rating(
    sum: f64,
    rated_battle_count: i64,
) -> Result<Option<f64>, BatchRatingError> {
    project(sum, rated_battle_count, PLAYER_PRIOR_WEIGHT)
}

/// V6 team rating (`(sum + 1 × 475) / (count + 1)`); `None` when nothing was rated.
pub fn team_batch_rating(
    sum: f64,
    rated_battle_count: i64,
) -> Result<Option<f64>, BatchRatingError> {
    project(sum, rated_battle_count, TEAM_PRIOR_WEIGHT)
}

/// Validates one unrounded V4.1 Final Rating before it enters batch state.
pub fn require_observation(rating: f64) -> Result<(), BatchRatingError> {
    if !rating.is_finite() || rating < 0.0 || rating > 1000.0 {
        return Err(BatchRatingError::ObservationOutOfRange(rating));
    }
    Ok(())
}

fn project(
    sum: f64,
    rated_battle_count: i64,
    prior_weight: i64,
) -> Result<Option<f64>, BatchRatingError> {
    validate_aggregate(sum, rated_battle_count)?;
    if rated_battle_count == 0 {
        return Ok(None);
    }
    let projected =
        (sum + prior_weight as f64 * V6_ANCHOR) / (rated_battle_count + prior_weight) as f64;
    if !projected.is_finite() || projected < 0.0 || projected > 1000.0 {
        return Err(BatchRatingError::ProjectionOutOfRange(projected));
    }
    Ok(Some(projected))
}

fn validate_aggregate(sum: f64, rated_battle_count: i64) -> Result<(), BatchRatingError> {
    if rated_battle_count < 0 {
        return Err(BatchRatingError::NegativeBattleCount(rated_battle_count));
    }
    if !sum.is_finite() {
        return Err(BatchRatingError::NonFiniteSum(sum));
    }
    if rated_battle_count == 0 {
        if sum != 0.0 {
            return Err(BatchRatingError::EmptyAggregateWithSum(sum));
        }
        return Ok(());
    }
    if sum < 0.0 || sum > rated_battle_count as f64 * 1000.0 {
        return Err(BatchRatingError::SumOutOfRange(sum));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn priors_are_player_five_team_one() {
        // N=1, S=1000 -> (1000 + 5*475) / 6
        let player = player_batch_rating(1000.0, 1).unwrap().unwrap();
        assert!(
            (player - (1000.0 + 5.0 * 475.0) / 6.0).abs() < 1e-12,
            "{player}"
        );
        let team = team_batch_rating(1000.0, 1).unwrap().unwrap();
        assert!((team - (1000.0 + 475.0) / 2.0).abs() < 1e-12, "{team}");
        // No rated battles -> no rating at all.
        assert_eq!(player_batch_rating(0.0, 0).unwrap(), None);
        assert_eq!(observed_mean(0.0, 0).unwrap(), None);
        assert_eq!(observed_mean(1500.0, 3).unwrap(), Some(500.0));
    }

    #[test]
    fn invalid_aggregates_fail_closed() {
        assert!(player_batch_rating(0.0, -1).is_err());
        assert!(player_batch_rating(10.0, 0).is_err());
        assert!(player_batch_rating(2001.0, 2).is_err());
        assert!(player_batch_rating(f64::NAN, 1).is_err());
        assert!(require_observation(1000.1).is_err());
        assert!(require_observation(999.9).is_ok());
    }
}
