//! League Rating eligibility gates and duplicate-replay settlement identity.
//!
//! Ports `com.wotb.core.rating.LeagueRatingValidator` and `LeagueRatingConflictDetector`.
//!
//! Zero-value policy (inherited from the protobuf wire): structural fields (identity, team, vehicle,
//! winner) fail closed on `0`/invalid, while statistical fields are legitimately `0` — an absent
//! protobuf field and a real zero are indistinguishable, so only *contradictions* (negatives,
//! hits > shots, penetrations > hits) are rejected. Settlement `lifeTime` is the only death
//! authority; live reconstruction never participates.

use serde::{Deserialize, Serialize};

use super::normalizer::{TEAM_SIZE, TOTAL_PLAYERS};
use crate::result::{BattleResult, ParticipantResult};

/// Stable English failure codes (mapped to three locales on the frontend).
pub const CODE_ARENA_ID_MISSING: &str = "LEAGUE_ARENA_ID_MISSING";
pub const CODE_NOT_SEVEN_VS_SEVEN: &str = "LEAGUE_NOT_SEVEN_VS_SEVEN";
pub const CODE_INVALID_TEAM: &str = "LEAGUE_INVALID_TEAM";
pub const CODE_DUPLICATE_ACCOUNT_ID: &str = "LEAGUE_DUPLICATE_ACCOUNT_ID";
pub const CODE_MISSING_TANK: &str = "LEAGUE_MISSING_TANK";
pub const CODE_NO_DECISIVE_WINNER: &str = "LEAGUE_NO_DECISIVE_WINNER";
pub const CODE_INVALID_STAT_FACTS: &str = "LEAGUE_INVALID_STAT_FACTS";
pub const CODE_CONFLICTING_REPLAYS_FOR_ARENA: &str = "CONFLICTING_REPLAYS_FOR_ARENA";

/// Settlement lifetime may round at most one second beyond the recorded battle duration.
const DEATH_TIME_TOLERANCE_SEC: f64 = 1.0;

/// One eligibility failure. `file_name` is filled in by the batch layer, which is where a replay
/// becomes a named input.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LeagueFailure {
    pub file_name: String,
    pub arena_id: String,
    pub code: String,
}

impl LeagueFailure {
    fn new(arena_id: &str, code: &str) -> Self {
        Self {
            file_name: String::new(),
            arena_id: arena_id.to_string(),
            code: code.to_string(),
        }
    }

    /// Binds the failure to the replay file that produced it.
    pub fn with_file_name(mut self, file_name: &str) -> Self {
        self.file_name = file_name.to_string();
        self
    }
}

/// Validates one battle; an empty result means it is eligible for League Rating.
///
/// Every discovered failure is returned (callers surface the first as the battle's error code).
pub fn validate(battle: &BattleResult) -> Vec<LeagueFailure> {
    let arena = battle.arena_id.as_str();
    let players = &battle.participants;
    let mut failures = Vec::new();

    if arena.trim().is_empty() {
        failures.push(LeagueFailure::new("", CODE_ARENA_ID_MISSING));
    }

    // Exactly 14 settled records, two teams of seven, teams limited to 1/2.
    if players.len() != TOTAL_PLAYERS {
        failures.push(LeagueFailure::new(arena, CODE_NOT_SEVEN_VS_SEVEN));
    }
    let mut team1 = 0usize;
    let mut team2 = 0usize;
    let mut invalid_team = false;
    for player in players {
        match player.team {
            Some(1) => team1 += 1,
            Some(2) => team2 += 1,
            _ => invalid_team = true,
        }
    }
    if invalid_team {
        failures.push(LeagueFailure::new(arena, CODE_INVALID_TEAM));
    } else if players.len() == TOTAL_PLAYERS && (team1 != TEAM_SIZE || team2 != TEAM_SIZE) {
        failures.push(LeagueFailure::new(arena, CODE_NOT_SEVEN_VS_SEVEN));
    }

    // 14 unique, non-zero account ids.
    let mut accounts = std::collections::HashSet::new();
    let mut duplicate_or_zero = false;
    for player in players {
        if is_zero_identifier(&player.game_account_id) || !accounts.insert(&player.game_account_id)
        {
            duplicate_or_zero = true;
        }
    }
    if duplicate_or_zero {
        failures.push(LeagueFailure::new(arena, CODE_DUPLICATE_ACCOUNT_ID));
    }

    // Every settled combatant has a vehicle.
    if players
        .iter()
        .any(|player| player.vehicle_id.as_deref().is_none_or(is_zero_identifier))
    {
        failures.push(LeagueFailure::new(arena, CODE_MISSING_TANK));
    }

    // A decisive winner is required; a draw or unknown winner produces no Rating.
    if !matches!(battle.winner_team, Some(1) | Some(2)) {
        failures.push(LeagueFailure::new(arena, CODE_NO_DECISIVE_WINNER));
    }

    if has_invalid_settlement_death_time(battle, players) || has_invalid_stat_facts(players) {
        failures.push(LeagueFailure::new(arena, CODE_INVALID_STAT_FACTS));
    }

    failures
}

fn is_zero_identifier(value: &str) -> bool {
    value.is_empty() || value == "0"
}

/// `true` when a dead combatant lacks a usable settlement death second.
fn has_invalid_settlement_death_time(battle: &BattleResult, players: &[ParticipantResult]) -> bool {
    let duration = match battle.settlement_duration_sec {
        Some(value) if value.is_finite() && value > 0.0 => Some(value),
        _ => battle.duration_sec,
    };
    for player in players {
        if player.survived {
            continue;
        }
        let Some(life_time) = player.settlement_life_time_sec else {
            return true;
        };
        if life_time <= 0 {
            return true;
        }
        if let Some(duration) = duration.filter(|value| value.is_finite() && *value > 0.0) {
            if life_time as f64 > duration + DEATH_TIME_TOLERANCE_SEC {
                return true;
            }
        }
    }
    false
}

/// Contradiction check for statistical fields (absence/zero is legal, contradictions are not).
fn has_invalid_stat_facts(players: &[ParticipantResult]) -> bool {
    let negative = |value: Option<i64>| value.is_some_and(|value| value < 0);
    for player in players {
        if negative(player.shots)
            || negative(player.hits_dealt)
            || negative(player.penetrations_dealt)
            || negative(player.damage_dealt)
            || negative(player.damage_assisted)
            || negative(player.damage_received)
            || negative(player.kills)
            || negative(player.damage_blocked)
            || negative(player.victory_points_earned)
            || negative(player.victory_points_seized)
            || negative(player.hits_received)
            || negative(player.penetrations_received)
            || negative(player.enemies_damaged)
        {
            return true;
        }
        if player
            .settlement_life_time_sec
            .is_some_and(|value| value < 0)
        {
            return true;
        }
        let shots = player.shots.unwrap_or(0);
        let hits = player.hits_dealt.unwrap_or(0);
        let penetrations = player.penetrations_dealt.unwrap_or(0);
        if shots > 0 && hits > shots {
            return true;
        }
        if hits > 0 && penetrations > hits {
            return true;
        }
    }
    false
}

/// Deterministic settlement/Rating fingerprint.
///
/// Duplicate identity is `#301` settlement-only: exactly the facts Rating consumes. Deliberately
/// excluded are the roster(`#201`), `roster_complete`, clan, killer/result-entity ids and any live
/// reconstruction provenance, so a replay with richer live evidence never mutates rating identity.
pub fn fingerprint(battle: &BattleResult) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "w={:?};t={:?};d={:?}",
        battle.winner_team, battle.battle_mode, battle.duration_sec
    ));

    // Numeric account ordering, matching the production TreeMap<Long, …>.
    let mut players: Vec<&ParticipantResult> = battle.participants.iter().collect();
    players.sort_by(|a, b| {
        let left: u64 = a.game_account_id.parse().unwrap_or(u64::MAX);
        let right: u64 = b.game_account_id.parse().unwrap_or(u64::MAX);
        left.cmp(&right)
            .then_with(|| a.game_account_id.cmp(&b.game_account_id))
    });

    for player in players {
        out.push_str(&format!(
            ";p={}:{:?}:{:?}:{}:{:?}:{:?}:{:?}:{:?}:{:?}:{:?}:{:?}:{:?}:{:?}:{:?}:{:?}:{:?}:{:?}:{:?}:{:?}",
            player.game_account_id,
            player.team,
            player.vehicle_id,
            player.survived,
            player.settlement_life_time_sec,
            player.death_reason_raw,
            player.damage_dealt,
            player.damage_assisted,
            player.damage_received,
            player.damage_blocked,
            player.kills,
            player.shots,
            player.hits_dealt,
            player.penetrations_dealt,
            player.victory_points_earned,
            player.victory_points_seized,
            player.hits_received,
            player.penetrations_received,
            player.enemies_damaged,
        ));
    }
    out
}

/// Two copies are duplicates only when their settlement/Rating fingerprints match.
pub fn consistent(a: &BattleResult, b: &BattleResult) -> bool {
    fingerprint(a) == fingerprint(b)
}

/// Group-level check against the first (canonical) copy; never mutates a battle.
pub fn validate_copies(copies: &[&BattleResult]) -> bool {
    let Some(canonical) = copies.first() else {
        return false;
    };
    let canonical = fingerprint(canonical);
    copies[1..]
        .iter()
        .all(|copy| fingerprint(copy) == canonical)
}

/// Convenience: the first failure code, if the battle is not eligible.
pub fn first_failure_code(battle: &BattleResult) -> Option<String> {
    validate(battle)
        .into_iter()
        .next()
        .map(|failure| failure.code)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meta::ParseQuality;

    fn participant(account: &str, team: i64, vehicle: &str) -> ParticipantResult {
        ParticipantResult {
            participant_ref: account.to_string(),
            game_account_id: account.to_string(),
            nickname: Some(format!("N{account}")),
            clan: None,
            team: Some(team),
            vehicle_id: Some(vehicle.to_string()),
            damage_dealt: Some(1000),
            damage_assisted: Some(100),
            damage_received: Some(500),
            damage_blocked: Some(200),
            kills: Some(1),
            shots: Some(10),
            hits_dealt: Some(6),
            penetrations_dealt: Some(4),
            hits_received: Some(2),
            penetrations_received: Some(1),
            enemies_damaged: Some(2),
            survived: false,
            settlement_life_time_sec: Some(120),
            death_reason_raw: Some(0),
            killer_account_id: None,
            victory_points_earned: Some(50),
            victory_points_seized: Some(10),
        }
    }

    fn eligible_battle() -> BattleResult {
        let mut participants = Vec::new();
        for index in 0..14 {
            participants.push(participant(
                &(1_000 + index).to_string(),
                if index < 7 { 1 } else { 2 },
                "4481",
            ));
        }
        BattleResult {
            arena_id: "1234567890".to_string(),
            game_version: None,
            battle_time: None,
            duration_sec: Some(300.0),
            settlement_duration_sec: Some(300.0),
            settlement_finish_reason_raw: None,
            battle_mode: Some(4),
            map: None,
            recorder_vehicle: None,
            winner_team: Some(1),
            roster_len: 14,
            roster_complete: true,
            participants,
            quality: ParseQuality::default(),
        }
    }

    #[test]
    fn eligible_seven_vs_seven_passes_every_gate() {
        assert!(validate(&eligible_battle()).is_empty());
    }

    #[test]
    fn roster_size_team_and_identity_gates_fail_closed() {
        let mut battle = eligible_battle();
        battle.participants.pop();
        assert!(validate(&battle)
            .iter()
            .any(|f| f.code == CODE_NOT_SEVEN_VS_SEVEN));

        let mut battle = eligible_battle();
        battle.participants[0].team = Some(3);
        assert!(validate(&battle)
            .iter()
            .any(|f| f.code == CODE_INVALID_TEAM));

        let mut battle = eligible_battle();
        battle.participants[1].game_account_id = battle.participants[0].game_account_id.clone();
        assert!(validate(&battle)
            .iter()
            .any(|f| f.code == CODE_DUPLICATE_ACCOUNT_ID));

        let mut battle = eligible_battle();
        battle.participants[0].game_account_id = "0".to_string();
        assert!(validate(&battle)
            .iter()
            .any(|f| f.code == CODE_DUPLICATE_ACCOUNT_ID));

        let mut battle = eligible_battle();
        battle.participants[0].vehicle_id = Some("0".to_string());
        assert!(validate(&battle)
            .iter()
            .any(|f| f.code == CODE_MISSING_TANK));

        let mut battle = eligible_battle();
        battle.winner_team = None;
        assert!(validate(&battle)
            .iter()
            .any(|f| f.code == CODE_NO_DECISIVE_WINNER));

        let mut battle = eligible_battle();
        battle.arena_id = "  ".to_string();
        assert!(validate(&battle)
            .iter()
            .any(|f| f.code == CODE_ARENA_ID_MISSING));
    }

    #[test]
    fn settlement_facts_gate_is_strict_but_allows_legitimate_zeroes() {
        // A dead combatant without a settlement second is invalid.
        let mut battle = eligible_battle();
        battle.participants[0].settlement_life_time_sec = None;
        assert!(validate(&battle)
            .iter()
            .any(|f| f.code == CODE_INVALID_STAT_FACTS));

        // Death beyond duration + 1s tolerance is invalid.
        let mut battle = eligible_battle();
        battle.participants[0].settlement_life_time_sec = Some(302);
        assert!(!validate(&battle).is_empty());
        battle.participants[0].settlement_life_time_sec = Some(301);
        assert!(validate(&battle).is_empty(), "one second of tolerance");

        // Contradictory counters are invalid even though zeroes are legal.
        let mut battle = eligible_battle();
        battle.participants[0].hits_dealt = Some(11);
        assert!(validate(&battle)
            .iter()
            .any(|f| f.code == CODE_INVALID_STAT_FACTS));

        let mut battle = eligible_battle();
        for player in &mut battle.participants {
            player.damage_dealt = Some(0);
            player.kills = Some(0);
            player.victory_points_earned = Some(0);
            player.victory_points_seized = Some(0);
        }
        assert!(
            validate(&battle).is_empty(),
            "all-zero statistics are legal"
        );
    }

    #[test]
    fn fingerprint_tracks_settlement_identity_only() {
        let battle = eligible_battle();
        let mut duplicate = eligible_battle();
        // Roster/nickname/clan evidence is not rating identity.
        duplicate.participants[0].nickname = Some("RENAMED".to_string());
        duplicate.participants[0].clan = Some("CLAN".to_string());
        duplicate.roster_complete = false;
        assert!(consistent(&battle, &duplicate));

        let mut conflicting = eligible_battle();
        conflicting.participants[5].damage_dealt = Some(999);
        assert!(!consistent(&battle, &conflicting));

        let mut different_winner = eligible_battle();
        different_winner.winner_team = Some(2);
        assert!(!consistent(&battle, &different_winner));

        assert!(validate_copies(&[&battle, &duplicate]));
        assert!(!validate_copies(&[&battle, &conflicting]));
        assert!(!validate_copies(&[&battle, &duplicate, &conflicting]));
        assert!(!validate_copies(&[]));
    }

    #[test]
    fn first_failure_code_is_the_stable_wire_code() {
        let mut battle = eligible_battle();
        battle.winner_team = None;
        assert_eq!(
            first_failure_code(&battle).as_deref(),
            Some(CODE_NO_DECISIVE_WINNER)
        );
        assert_eq!(first_failure_code(&eligible_battle()), None);
    }

    #[test]
    fn failure_binds_its_file_name() {
        let failure = LeagueFailure::new("123", CODE_MISSING_TANK).with_file_name("a.wotbreplay");
        assert_eq!(failure.file_name, "a.wotbreplay");
        assert_eq!(failure.arena_id, "123");
        assert_eq!(failure.code, CODE_MISSING_TANK);
    }
}
