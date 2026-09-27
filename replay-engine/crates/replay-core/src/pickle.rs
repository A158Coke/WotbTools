//! `battle_results.dat` framing: a Python pickle of a two-tuple `(arenaUniqueId, protobuf bytes)`.
//!
//! Authority: `docs/reference/replay-data.md`. The pickle layer is decoded with the `serde-pickle`
//! crate (MIT) instead of a hand-written stack machine; the protobuf payload is handed back raw so
//! the settlement mapper can read tags the upstream crates do not model (`#24` lifeTime, `#25`
//! killer, `#105` deathReason).

use crate::error::ReplayError;

pub struct SettlementPayload {
    pub arena_id: u64,
    pub protobuf: Vec<u8>,
}

pub fn decode_battle_results(bytes: &[u8]) -> Result<SettlementPayload, ReplayError> {
    let (arena_id, protobuf): (u64, serde_bytes::ByteBuf) =
        serde_pickle::from_slice(bytes, serde_pickle::DeOptions::new())
            .map_err(|e| ReplayError::InvalidResults(format!("pickle decode failed: {e}")))?;
    if protobuf.is_empty() {
        return Err(ReplayError::InvalidResults(
            "pickle tuple carries an empty protobuf payload".to_string(),
        ));
    }
    Ok(SettlementPayload {
        arena_id,
        protobuf: protobuf.into_vec(),
    })
}
