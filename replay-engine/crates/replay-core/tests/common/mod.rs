//! Shared helpers for the golden parity tests.

use std::path::PathBuf;

/// Committed golden produced by `tests/java-golden/RatingGoldenDumper.java`.
pub fn golden_path() -> PathBuf {
    [
        env!("CARGO_MANIFEST_DIR"),
        "..",
        "..",
        "tests",
        "golden",
        "league-rating-v41.json",
    ]
    .iter()
    .collect()
}

/// The port must be numerically indistinguishable from production, not merely close.
pub fn assert_close(actual: f64, expected: f64, context: &str) {
    let tolerance = 1e-9 * (1.0 + expected.abs());
    assert!(
        (actual - expected).abs() <= tolerance,
        "{context}: expected {expected}, got {actual} (delta {})",
        (actual - expected).abs()
    );
}
