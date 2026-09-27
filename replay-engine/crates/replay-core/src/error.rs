//! Error model for the client replay engine.
//!
//! Codes are stable, English and transport-agnostic: the WASM boundary reports them verbatim so a
//! consumer can map them without parsing prose. Result-level and stream-level failures are
//! deliberately separate: a failed stream must never make the settlement result unusable.

use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ReplayError {
    /// The ZIP container itself violates the `.wotbreplay` contract.
    #[error("invalid replay archive: {0}")]
    InvalidArchive(String),
    /// `battle_results.dat` is absent or its pickle/protobuf framing is unusable.
    #[error("invalid battle results: {0}")]
    InvalidResults(String),
    /// A dead combatant has no usable settlement `lifeTime` second.
    #[error("invalid settlement facts: {0}")]
    InvalidSettlement(String),
    /// Packet stream framing/decoding failed. Only `parseStream` produces this.
    #[error("corrupted packet stream: {0}")]
    CorruptedStream(String),
    /// Entity id -> participant mapping could not be resolved.
    #[error("unresolved entity mapping: {0}")]
    UnresolvedEntityMapping(String),
    /// Battle-relative clock could not be resolved.
    #[error("unresolved battle clock: {0}")]
    UnresolvedClock(String),
    /// Position coverage is too sparse for the requested projection.
    #[error("insufficient position coverage: {0}")]
    InsufficientPositionCoverage(String),
}

impl ReplayError {
    /// Stable machine-readable code shared with the wire/consumer layers.
    pub fn code(&self) -> &'static str {
        match self {
            ReplayError::InvalidArchive(_) => "INVALID_ARCHIVE",
            ReplayError::InvalidResults(_) => "INVALID_RESULTS",
            ReplayError::InvalidSettlement(_) => "INVALID_RESULTS",
            ReplayError::CorruptedStream(_) => "CORRUPTED_STREAM",
            ReplayError::UnresolvedEntityMapping(_) => "UNRESOLVED_ENTITY_MAPPING",
            ReplayError::UnresolvedClock(_) => "UNRESOLVED_CLOCK",
            ReplayError::InsufficientPositionCoverage(_) => "INSUFFICIENT_POSITION_COVERAGE",
        }
    }
}

/// Non-fatal degradations recorded on a result instead of failing the whole parse.
///
/// There is deliberately no `MISSING_META`: the container contract requires all three entries, so
/// only *unreadable* metadata can occur (`INVALID_META`).
pub const LIMITATION_INVALID_META: &str = "INVALID_META";
pub const LIMITATION_ROSTER_MISSING: &str = "ROSTER_MISSING";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_stable() {
        assert_eq!(
            ReplayError::InvalidArchive("x".into()).code(),
            "INVALID_ARCHIVE"
        );
        assert_eq!(
            ReplayError::CorruptedStream("x".into()).code(),
            "CORRUPTED_STREAM"
        );
    }
}
