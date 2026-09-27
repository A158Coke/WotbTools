//! `meta.json` metadata.
//!
//! Robustness contract: `meta.json` is *enrichment*. A strict-UTF-8 or JSON failure degrades the
//! result with a recorded limitation instead of failing `parseResult`, because every field it
//! carries that business depends on is also recoverable from the settlement blob
//! (`arenaId`, `duration`, `winnerTeam`, roster, vehicle ids).

use serde::{Deserialize, Serialize};

use crate::error::LIMITATION_INVALID_META;

/// The 14 keys of the production contract, minus the ones deliberately not consumed.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ReplayMeta {
    pub version: Option<String>,
    pub player_name: Option<String>,
    pub battle_start_time: Option<i64>,
    pub player_vehicle_name: Option<String>,
    pub map_name: Option<String>,
    pub arena_unique_id: Option<String>,
    pub battle_duration: Option<f64>,
    pub arena_bonus_type: Option<i64>,
    /// Recorded limitation when this metadata could not be read at all.
    pub limitation: Option<String>,
}

impl ReplayMeta {
    /// Never fails: an unreadable `meta.json` yields an empty meta plus a limitation.
    pub fn parse(bytes: &[u8]) -> Self {
        let value: serde_json::Value = match serde_json::from_slice(bytes) {
            Ok(value) => value,
            Err(_) => {
                return Self {
                    limitation: Some(LIMITATION_INVALID_META.to_string()),
                    ..Self::default()
                }
            }
        };
        let get = |key: &str| value.get(key);
        let string = |key: &str| {
            get(key)
                .and_then(serde_json::Value::as_str)
                .map(str::to_owned)
        };
        Self {
            version: string("version"),
            player_name: string("playerName"),
            battle_start_time: string("battleStartTime").and_then(|v| v.parse::<i64>().ok()),
            player_vehicle_name: string("playerVehicleName"),
            map_name: string("mapName"),
            arena_unique_id: string("arenaUniqueId"),
            battle_duration: get("battleDuration").and_then(serde_json::Value::as_f64),
            arena_bonus_type: get("arenaBonusType").and_then(serde_json::Value::as_i64),
            limitation: None,
        }
    }
}

/// Result-level record of what could not be established for this replay.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct ParseQuality {
    pub meta_available: bool,
    pub limitations: Vec<String>,
}

impl ParseQuality {
    pub fn note(&mut self, limitation: &str) {
        if !self
            .limitations
            .iter()
            .any(|existing| existing == limitation)
        {
            self.limitations.push(limitation.to_string());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_known_keys() {
        let raw = br#"{"version":"11.19.0_china","playerName":"A","battleStartTime":"1781873222",
            "playerVehicleName":"S16_Kranvagn","mapName":"lagoon","arenaUniqueId":"1161909687528274499",
            "battleDuration":306.19186,"arenaBonusType":1}"#;
        let meta = ReplayMeta::parse(raw);
        assert_eq!(meta.version.as_deref(), Some("11.19.0_china"));
        assert_eq!(meta.battle_start_time, Some(1_781_873_222));
        assert_eq!(meta.battle_duration, Some(306.19186));
        assert_eq!(meta.arena_bonus_type, Some(1));
        assert_eq!(meta.limitation, None);
    }

    #[test]
    fn invalid_utf8_degrades_without_failing() {
        let raw = [0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d];
        let meta = ReplayMeta::parse(&raw);
        assert_eq!(meta.limitation.as_deref(), Some(LIMITATION_INVALID_META));
        assert_eq!(meta.version, None);
    }

    #[test]
    fn invalid_json_degrades_without_failing() {
        let meta = ReplayMeta::parse(b"{not json");
        assert_eq!(meta.limitation.as_deref(), Some(LIMITATION_INVALID_META));
    }
}
