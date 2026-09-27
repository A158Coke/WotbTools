//! Canonical battle result (`parseResult`).
//!
//! Ports the authoritative settlement mapping of `com.wotb.core.parse.ReplayParser` (tag constants
//! `ReplayParser.java:35-47`) into the client engine. Reads `meta.json` + `battle_results.dat`
//! only — never `data.wotreplay`.
//!
//! Identifier contract: every identifier that can exceed the JS safe-integer range (`arenaId`,
//! `gameAccountId`, `vehicleId`) leaves this module as a decimal **string**.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use crate::container::ReplayArchive;
use crate::error::ReplayError;
use crate::meta::{ParseQuality, ReplayMeta};
use crate::pickle::decode_battle_results;
use crate::protobuf::Message;

// Settlement root fields.
const F_BATTLE_START: u32 = 2;
const F_WINNER_TEAM: u32 = 3;
const F_SETTLEMENT_FINISH_REASON: u32 = 4;
const F_SETTLEMENT_DURATION: u32 = 5;
const F_ROSTER: u32 = 201;
const F_PLAYER_RESULTS: u32 = 301;

/// Java parity (`ReplayParser.java:238-249`): durations above this are clamped, and timestamps at or
/// below 2014-01-01 are treated as absent rather than surfaced as a bogus battle time.
const MAX_BATTLE_DURATION_SEC: f64 = 420.0;
const MIN_PLAUSIBLE_EPOCH_SEC: i64 = 1_388_534_400;

// Roster entry (#201).
const F_ACCOUNT_ID: u32 = 1;
const F_PLAYER_INFO: u32 = 2;

// PlayerInfo (#201 -> #2).
const R_NICKNAME: u32 = 1;
const R_TEAM: u32 = 3;
const R_CLAN: u32 = 5;

// PlayerResults entry (#301): outer field 1 is the result/entity id namespace.
const F_RESULT_ENTITY: u32 = 1;
const F_RESULT_INFO: u32 = 2;

// PlayerResultInfo (#301 -> #2).
const F_SHOTS: u32 = 4;
const F_HITS: u32 = 5;
const F_PENS: u32 = 7;
const F_DAMAGE: u32 = 8;
const F_ASSIST: [u32; 2] = [9, 10];
const F_RECEIVED: u32 = 11;
const F_HITS_RECV: u32 = 12;
const F_PENS_RECV: u32 = 15;
const F_ENEMIES_DAMAGED: u32 = 17;
const F_KILLS: u32 = 18;
const F_LIFE_TIME: u32 = 24;
const F_KILLER: u32 = 25;
const F_POINTS_EARNED: u32 = 32;
const F_POINTS_SEIZED: u32 = 33;
const F_ACCOUNT: u32 = 101;
const F_TEAM: u32 = 102;
const F_TANK: u32 = 103;
const F_DEATH_REASON: u32 = 105;
const F_BLOCKED: u32 = 117;

/// Sentinel proving the combatant finished the battle alive (`#105 == -1`).
const DEATH_REASON_SURVIVOR: i64 = -1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BattleResult {
    /// Decimal string; may exceed the JS safe-integer range.
    pub arena_id: String,
    pub game_version: Option<String>,
    /// Battle start (unix seconds). Settlement `root2` is primary, `meta.battleStartTime` the
    /// fallback, and implausible epochs are dropped — same order as `ReplayParser.java:246-249`.
    pub battle_time: Option<i64>,
    /// Effective battle duration: settlement `root5` first, `meta.battleDuration` as fallback,
    /// clamped to 420s (`ReplayParser.java:239-245`).
    pub duration_sec: Option<f64>,
    /// Raw settlement duration in seconds (`root5`), untouched by the clamp.
    pub settlement_duration_sec: Option<f64>,
    /// Raw settlement finish-reason code (`root4`).
    pub settlement_finish_reason_raw: Option<i64>,
    pub battle_mode: Option<i64>,
    pub map: Option<String>,
    pub recorder_vehicle: Option<String>,
    pub winner_team: Option<i64>,
    pub roster_len: usize,
    /// Java `Battle.rosterComplete` parity (`ReplayParser.resolveRosterComplete`): the `#201` account
    /// set must equal the `#301` account set and every shared account must agree on team. A fixture
    /// whose roster carries non-combatant extras is deliberately `false` (strict fail-closed).
    pub roster_complete: bool,
    pub participants: Vec<ParticipantResult>,
    pub quality: ParseQuality,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParticipantResult {
    /// Stable per-battle reference for consumers (settlement identity).
    pub participant_ref: String,
    pub game_account_id: String,
    pub nickname: Option<String>,
    pub clan: Option<String>,
    pub team: Option<i64>,
    pub vehicle_id: Option<String>,
    pub damage_dealt: Option<i64>,
    pub damage_assisted: Option<i64>,
    pub damage_received: Option<i64>,
    pub damage_blocked: Option<i64>,
    pub kills: Option<i64>,
    pub shots: Option<i64>,
    pub hits_dealt: Option<i64>,
    pub penetrations_dealt: Option<i64>,
    pub hits_received: Option<i64>,
    pub penetrations_received: Option<i64>,
    pub enemies_damaged: Option<i64>,
    pub survived: bool,
    /// Settlement `#24` seconds: death second, or the full battle duration when survived.
    pub settlement_life_time_sec: Option<i64>,
    pub death_reason_raw: Option<i64>,
    /// Resolved through the result/entity-id namespace, never a raw account id.
    pub killer_account_id: Option<String>,
    pub victory_points_earned: Option<i64>,
    /// Retained as an objective settlement fact; not part of any Rating dimension.
    pub victory_points_seized: Option<i64>,
}

/// `parseResult(replayBytes) -> BattleResult`.
pub fn parse_result(bytes: &[u8]) -> Result<BattleResult, ReplayError> {
    let archive = ReplayArchive::open(bytes)?;
    let mut quality = ParseQuality {
        meta_available: true,
        limitations: Vec::new(),
    };
    let meta = ReplayMeta::parse(&archive.read_meta()?);
    if let Some(limitation) = meta.limitation.as_deref() {
        quality.meta_available = false;
        quality.note(limitation);
    }

    let payload = decode_battle_results(&archive.read_results()?)?;
    let root = Message::decode(&payload.protobuf)?;

    let roster = roster_entries(&root)?;
    let mut participants = settlement_participants(&root, &roster)?;
    let winner_team = root.int(F_WINNER_TEAM);

    // Battle-level timing: settlement is authoritative, metadata is the fallback.
    let settlement_start_time = root.int(F_BATTLE_START);
    let settlement_duration_sec = root.number(F_SETTLEMENT_DURATION);
    let settlement_finish_reason_raw = root.int(F_SETTLEMENT_FINISH_REASON);
    let duration_sec = match settlement_duration_sec {
        Some(value) if value > 0.0 => Some(value.min(MAX_BATTLE_DURATION_SEC)),
        _ => meta
            .battle_duration
            .map(|value| value.min(MAX_BATTLE_DURATION_SEC)),
    };
    let battle_time = match settlement_start_time {
        Some(value) if value > MIN_PLAUSIBLE_EPOCH_SEC => Some(value),
        _ => meta
            .battle_start_time
            .filter(|value| *value > MIN_PLAUSIBLE_EPOCH_SEC),
    };

    let roster_len = roster.len();
    let roster_complete = resolve_roster_complete(&roster, &participants);
    if roster_len == 0 {
        quality.note(crate::error::LIMITATION_ROSTER_MISSING);
    }

    // Deterministic participant order: team, then account id.
    participants.sort_by(|a, b| {
        a.team
            .unwrap_or(i64::MAX)
            .cmp(&b.team.unwrap_or(i64::MAX))
            .then_with(|| a.game_account_id.cmp(&b.game_account_id))
    });

    Ok(BattleResult {
        arena_id: payload.arena_id.to_string(),
        game_version: meta.version.clone(),
        battle_time,
        duration_sec,
        settlement_duration_sec,
        settlement_finish_reason_raw,
        battle_mode: meta.arena_bonus_type,
        map: meta.map_name.clone(),
        recorder_vehicle: meta.player_vehicle_name.clone(),
        winner_team,
        roster_len,
        roster_complete,
        participants,
        quality,
    })
}

/// Ports `ReplayParser.resolveRosterComplete`: strict set equality plus team agreement.
fn resolve_roster_complete(roster: &[RosterEntry], participants: &[ParticipantResult]) -> bool {
    if roster.is_empty() || participants.is_empty() {
        return false;
    }
    let roster_accounts: BTreeSet<&str> = roster.iter().map(|r| r.account_id.as_str()).collect();
    let result_accounts: BTreeSet<&str> = participants
        .iter()
        .map(|p| p.game_account_id.as_str())
        .collect();
    if roster_accounts != result_accounts {
        return false;
    }
    participants.iter().all(|participant| {
        match (
            participant.team,
            roster
                .iter()
                .find(|r| r.account_id == participant.game_account_id)
                .and_then(|r| r.team),
        ) {
            (Some(settlement_team), Some(roster_team)) => settlement_team == roster_team,
            _ => true,
        }
    })
}

#[derive(Debug, Clone, PartialEq)]
struct RosterEntry {
    account_id: String,
    nickname: Option<String>,
    clan: Option<String>,
    team: Option<i64>,
}

fn roster_entries(root: &Message) -> Result<Vec<RosterEntry>, ReplayError> {
    let mut out = Vec::new();
    for entry in root.repeated(F_ROSTER)? {
        let Some(account_id) = entry.varint(F_ACCOUNT_ID) else {
            continue;
        };
        let info = entry.message(F_PLAYER_INFO)?.unwrap_or_default();
        out.push(RosterEntry {
            account_id: account_id.to_string(),
            nickname: info.string(R_NICKNAME).map(str::to_owned),
            clan: info.string(R_CLAN).map(str::to_owned),
            team: info.int(R_TEAM),
        });
    }
    Ok(out)
}

fn settlement_participants(
    root: &Message,
    roster: &[RosterEntry],
) -> Result<Vec<ParticipantResult>, ReplayError> {
    let entries = root.repeated(F_PLAYER_RESULTS)?;

    // result/entity id -> account id, so a killer id resolves inside its own namespace.
    let mut result_to_account = std::collections::HashMap::new();
    for entry in &entries {
        let (Some(result_entity), Some(info)) =
            (entry.varint(F_RESULT_ENTITY), entry.message(F_RESULT_INFO)?)
        else {
            continue;
        };
        if let Some(account) = info.varint(F_ACCOUNT) {
            result_to_account.insert(result_entity, account.to_string());
        }
    }

    let mut participants = Vec::with_capacity(entries.len());
    for entry in &entries {
        let Some(info) = entry.message(F_RESULT_INFO)? else {
            continue;
        };
        let Some(account) = info.varint(F_ACCOUNT) else {
            return Err(ReplayError::InvalidResults(
                "settlement player result without #101 account id".to_string(),
            ));
        };
        let account_id = account.to_string();
        let roster_entry = roster.iter().find(|r| r.account_id == account_id);

        let death_reason_raw = info.int(F_DEATH_REASON);
        let survived = death_reason_raw == Some(DEATH_REASON_SURVIVOR);
        let life_time = info.int(F_LIFE_TIME);
        if !survived && life_time.unwrap_or(0) <= 0 {
            // Parity with ReplayParser: a dead combatant without a usable settlement lifeTime is
            // malformed data, not a "dead at unknown second" business state.
            return Err(ReplayError::InvalidSettlement(format!(
                "dead combatant missing settlement lifeTime: accountId={account_id}"
            )));
        }
        let killer_account_id = info
            .varint(F_KILLER)
            .and_then(|killer| result_to_account.get(&killer).cloned());

        participants.push(ParticipantResult {
            participant_ref: account_id.clone(),
            game_account_id: account_id,
            nickname: roster_entry.and_then(|r| r.nickname.clone()),
            clan: roster_entry.and_then(|r| r.clan.clone()),
            team: info.int(F_TEAM),
            vehicle_id: info.varint(F_TANK).map(|v| v.to_string()),
            damage_dealt: info.int(F_DAMAGE),
            // Assistance is the sum of its two settlement components; a fully absent pair stays
            // absent instead of being reported as a silent 0.
            damage_assisted: {
                let parts: Vec<i64> = F_ASSIST
                    .iter()
                    .filter_map(|field| info.int(*field))
                    .collect();
                if parts.is_empty() {
                    None
                } else {
                    Some(parts.iter().sum())
                }
            },
            damage_received: info.int(F_RECEIVED),
            damage_blocked: info.int(F_BLOCKED),
            kills: info.int(F_KILLS),
            shots: info.int(F_SHOTS),
            hits_dealt: info.int(F_HITS),
            penetrations_dealt: info.int(F_PENS),
            hits_received: info.int(F_HITS_RECV),
            penetrations_received: info.int(F_PENS_RECV),
            enemies_damaged: info.int(F_ENEMIES_DAMAGED),
            survived,
            settlement_life_time_sec: life_time,
            death_reason_raw,
            killer_account_id,
            victory_points_earned: info.int(F_POINTS_EARNED),
            victory_points_seized: info.int(F_POINTS_SEIZED),
        });
    }

    Ok(participants)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn varint_field(field: u32, value: u64, out: &mut Vec<u8>) {
        out.extend_from_slice(&encode_varint(u64::from(field) << 3));
        out.extend_from_slice(&encode_varint(value));
    }

    fn bytes_field(field: u32, payload: &[u8], out: &mut Vec<u8>) {
        out.extend_from_slice(&encode_varint((u64::from(field) << 3) | 2));
        out.extend_from_slice(&encode_varint(payload.len() as u64));
        out.extend_from_slice(payload);
    }

    fn encode_varint(mut value: u64) -> Vec<u8> {
        let mut out = Vec::new();
        loop {
            let byte = (value & 0x7f) as u8;
            value >>= 7;
            if value == 0 {
                out.push(byte);
                return out;
            }
            out.push(byte | 0x80);
        }
    }

    #[test]
    fn maps_survivor_and_dead_settlement_facts() {
        let mut survivor_info = Vec::new();
        varint_field(F_ACCOUNT, 42, &mut survivor_info);
        varint_field(F_TEAM, 1, &mut survivor_info);
        varint_field(F_TANK, 4481, &mut survivor_info);
        varint_field(F_DAMAGE, 1234, &mut survivor_info);
        varint_field(F_ASSIST[0], 100, &mut survivor_info);
        varint_field(F_ASSIST[1], 400, &mut survivor_info);
        varint_field(F_DEATH_REASON, u64::MAX, &mut survivor_info); // -1 survivor sentinel
        varint_field(F_LIFE_TIME, 300, &mut survivor_info);

        let mut dead_info = Vec::new();
        varint_field(F_ACCOUNT, 43, &mut dead_info);
        varint_field(F_TEAM, 2, &mut dead_info);
        varint_field(F_KILLS, 1, &mut dead_info);
        varint_field(F_DEATH_REASON, 5, &mut dead_info);
        varint_field(F_LIFE_TIME, 120, &mut dead_info);
        varint_field(F_KILLER, 9001, &mut dead_info);

        // killer namespace: a settlement entry's outer #1 is its result/entity id.
        let mut root = Vec::new();
        varint_field(F_WINNER_TEAM, 1, &mut root);
        bytes_field(F_ROSTER, &roster_entry(42, "Alice", "AAA", 1), &mut root);
        bytes_field(F_ROSTER, &roster_entry(43, "Bob", "BBB", 2), &mut root);
        let mut survivor_entry = Vec::new();
        varint_field(F_RESULT_ENTITY, 9001, &mut survivor_entry);
        bytes_field(F_RESULT_INFO, &survivor_info, &mut survivor_entry);
        bytes_field(F_PLAYER_RESULTS, &survivor_entry, &mut root);
        let mut dead_entry = Vec::new();
        varint_field(F_RESULT_ENTITY, 100, &mut dead_entry);
        bytes_field(F_RESULT_INFO, &dead_info, &mut dead_entry);
        bytes_field(F_PLAYER_RESULTS, &dead_entry, &mut root);

        let message = Message::decode(&root).expect("root decodes");
        let roster = roster_entries(&message).expect("roster");
        let participants = settlement_participants(&message, &roster).expect("participants");
        assert_eq!(participants.len(), 2);

        let alice = participants
            .iter()
            .find(|p| p.game_account_id == "42")
            .expect("alice");
        assert!(alice.survived);
        assert_eq!(alice.nickname.as_deref(), Some("Alice"));
        assert_eq!(alice.damage_assisted, Some(500));
        assert_eq!(alice.vehicle_id.as_deref(), Some("4481"));
        assert_eq!(alice.settlement_life_time_sec, Some(300));

        let bob = participants
            .iter()
            .find(|p| p.game_account_id == "43")
            .expect("bob");
        assert!(!bob.survived);
        assert_eq!(bob.kills, Some(1));
        assert_eq!(bob.death_reason_raw, Some(5));
        assert_eq!(bob.killer_account_id.as_deref(), Some("42"));
        assert_eq!(bob.clan.as_deref(), Some("BBB"));
    }

    #[test]
    fn rejects_dead_combatant_without_life_time() {
        let mut info = Vec::new();
        varint_field(F_ACCOUNT, 7, &mut info);
        varint_field(F_DEATH_REASON, 2, &mut info);
        let mut entry = Vec::new();
        bytes_field(F_RESULT_INFO, &info, &mut entry);
        let mut root = Vec::new();
        bytes_field(F_PLAYER_RESULTS, &entry, &mut root);

        let message = Message::decode(&root).expect("root decodes");
        let err = settlement_participants(&message, &[]).unwrap_err();
        assert_eq!(err.code(), "INVALID_RESULTS");
    }

    fn roster_entry(account: u64, nickname: &str, clan: &str, team: u64) -> Vec<u8> {
        let mut info = Vec::new();
        bytes_field(R_NICKNAME, nickname.as_bytes(), &mut info);
        bytes_field(R_CLAN, clan.as_bytes(), &mut info);
        varint_field(R_TEAM, team, &mut info);
        let mut entry = Vec::new();
        varint_field(F_ACCOUNT_ID, account, &mut entry);
        bytes_field(F_PLAYER_INFO, &info, &mut entry);
        entry
    }
}
