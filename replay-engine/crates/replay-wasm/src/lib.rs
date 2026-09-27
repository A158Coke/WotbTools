//! JS/WASM boundary.
//!
//! Wire shape rules:
//! - every u64-range identifier (`arenaId`, `gameAccountId`, `vehicleId`) is a decimal **string**,
//!   so it can never pass through a JS `number` and lose precision;
//! - a failed parse returns the stable English `code()` plus its message, never a panic;
//! - the boundary is JSON text, so the Vue side can reuse the same shape as the server transport.

use wasm_bindgen::prelude::*;

/// `parseResult(bytes) -> JSON string` of the canonical `BattleResult`.
#[wasm_bindgen]
pub fn parse_result(bytes: &[u8]) -> Result<String, JsValue> {
    let result = replay_core::parse_result(bytes)
        .map_err(|error| JsValue::from_str(&format!("{}: {}", error.code(), error)))?;
    serde_json::to_string(&result)
        .map_err(|error| JsValue::from_str(&format!("INVALID_RESULTS: serialize failed: {error}")))
}

/// Engine version for consumer gating.
#[wasm_bindgen]
pub fn engine_version() -> String {
    replay_core::engine_version().to_string()
}
