//! League Rating 归一化纯函数。
//!
//! Ports `com.wotb.core.league.LeagueRatingNormalizer` exactly: the team index `T`, the global rank
//! index `G` over the fixed 14-player field, the Wilson 95% lower bound (`z = 1.96`), and the shared
//! "finite and positive" predicate.

use std::cmp::Ordering;

/// Standard 7v7 team size.
pub const TEAM_SIZE: usize = 7;
/// Full battle field size: `G` normalizes against this constant, never against the actual count.
pub const TOTAL_PLAYERS: usize = 14;
/// Wilson confidence `z` for 95%.
pub const WILSON_Z: f64 = 1.96;

/// `finite && > 0`.
pub fn finite_positive(value: f64) -> bool {
    value.is_finite() && value > 0.0
}

/// Team contribution index `T(x)`: the team average maps to 0.5, twice the average caps at 1.
pub fn team_index(x: f64, team_average: f64) -> f64 {
    if !finite_positive(x) || !finite_positive(team_average) {
        return 0.0;
    }
    (x / (2.0 * team_average)).min(1.0)
}

/// Global rank index `G(x)` over the whole field: descending rank with ties sharing the average
/// rank, mapped from the fixed 14-player field.
pub fn global_index(x: f64, all: &[f64]) -> f64 {
    if !finite_positive(x) {
        return 0.0;
    }
    let mut sorted: Vec<f64> = all
        .iter()
        .copied()
        .filter(|value| finite_positive(*value))
        .collect();
    if sorted.is_empty() {
        return 0.0;
    }
    sorted.sort_by(|a, b| b.partial_cmp(a).unwrap_or(Ordering::Equal));

    let mut strictly_greater = 0usize;
    let mut tied = 0usize;
    for value in &sorted {
        if *value > x {
            strictly_greater += 1;
        } else if *value == x {
            tied += 1;
        } else {
            break;
        }
    }
    if tied == 0 {
        return 0.0;
    }
    // Ranks start at 1: the strictly greater values occupy 1..=strictlyGreater, the tied group
    // occupies [strictlyGreater + 1, strictlyGreater + tied].
    let average_rank = strictly_greater as f64 + (tied as f64 + 1.0) / 2.0;
    ((TOTAL_PLAYERS as f64 - average_rank) / (TOTAL_PLAYERS as f64 - 1.0)).clamp(0.0, 1.0)
}

/// Wilson score interval lower bound; `trials <= 0` (or a negative/non-finite input) yields 0.
pub fn wilson_lower_bound(successes: f64, trials: f64) -> f64 {
    wilson_lower_bound_with_z(successes, trials, WILSON_Z)
}

/// Wilson lower bound with an explicit `z` (kept for parity tests).
pub fn wilson_lower_bound_with_z(successes: f64, trials: f64, z: f64) -> f64 {
    if !finite_positive(trials) || successes < 0.0 || !successes.is_finite() {
        return 0.0;
    }
    let n = trials;
    let p = (successes / n).min(1.0);
    let z2 = z * z;
    let denominator = 1.0 + z2 / n;
    let center = (p + z2 / (2.0 * n)) / denominator;
    let margin = z * ((p * (1.0 - p) / n) + (z2 / (4.0 * n * n))).sqrt() / denominator;
    (center - margin).max(0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn team_index_maps_average_to_half_and_caps_at_one() {
        assert_eq!(team_index(0.0, 1000.0), 0.0);
        assert_eq!(team_index(1000.0, 1000.0), 0.5);
        assert_eq!(team_index(2000.0, 1000.0), 1.0);
        assert_eq!(team_index(4000.0, 1000.0), 1.0);
        assert_eq!(team_index(100.0, 0.0), 0.0);
    }

    #[test]
    fn global_index_matches_rank_semantics() {
        // Unique best -> rank 1 -> (14 - 1) / 13 = 1.0
        assert_eq!(global_index(100.0, &[100.0, 90.0, 80.0]), 1.0);
        // Zero value -> 0 regardless of the field.
        assert_eq!(global_index(0.0, &[100.0, 0.0]), 0.0);
        // All zeros -> everyone 0.
        assert_eq!(global_index(0.0, &[0.0, 0.0]), 0.0);
        // Two-way tie at the top shares average rank 1.5 -> (14 - 1.5) / 13
        let tied = global_index(100.0, &[100.0, 100.0, 1.0]);
        assert!((tied - (14.0 - 1.5) / 13.0).abs() < 1e-12, "{tied}");
    }

    #[test]
    fn wilson_lower_bound_punishes_tiny_samples() {
        // A single shot that hits must not look like a 100% hit rate.
        assert!(wilson_lower_bound(1.0, 1.0) < 0.5);
        assert_eq!(wilson_lower_bound(0.0, 0.0), 0.0);
        assert_eq!(wilson_lower_bound(5.0, 0.0), 0.0);
        assert_eq!(wilson_lower_bound(-1.0, 5.0), 0.0);
        // The bound converges upwards with evidence.
        assert!(wilson_lower_bound(50.0, 100.0) > wilson_lower_bound(5.0, 10.0));
    }
}
