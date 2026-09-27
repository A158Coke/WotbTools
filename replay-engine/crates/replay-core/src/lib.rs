//! WotBTools client replay engine — core.
//!
//! `parseResult` is the settlement half: `meta.json` + `battle_results.dat` -> [`result::BattleResult`].
//! It never reads `data.wotreplay`; the packet-stream half (`parseStream` -> StreamFacts) is a
//! separate entry point so a broken stream cannot make the settlement result unusable.
//!
//! No HTTP, no database, no framework, no filesystem-only API: the engine only accepts bytes.
//! Authority for the format is `docs/reference/replay-data.md`; protocol semantics follow
//! `docs/research/replay/README.md`.

pub mod aggregate;
pub mod container;
pub mod error;
pub mod meta;
pub mod pickle;
pub mod protobuf;
pub mod rating;
pub mod result;
pub mod stream;

pub use aggregate::{aggregate, Aggregate, VehicleUsage};
pub use error::ReplayError;
pub use meta::{ParseQuality, ReplayMeta};
pub use rating::{rate_battle, BattleRating, PlayerRating, RatingPlayer, TeamRating};
pub use result::{parse_result, BattleResult, ParticipantResult};
pub use stream::{Packet, PacketStream, ReplayStreamHeader, StreamDiagnostics};

/// Engine version; consumers use it to gate behaviour instead of guessing from a game version.
pub fn engine_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
