//! Aggregate parity against the production `com.wotb.core.stats.Aggregator`.
//!
//! The golden's `aggregateInput` battles are fed through the Rust accumulator and every counter,
//! rate and average is compared with the Java output. The tank **name** string is intentionally not
//! compared: the approved cleanup replaces that column with structured vehicle usage
//! (`docs/current-plan.md` §11.4 / B6), so only the structural invariant is asserted for vehicles.

use std::fs;

use replay_core::aggregate::aggregate;
use replay_core::meta::ParseQuality;
use replay_core::result::{BattleResult, ParticipantResult};
use serde::Deserialize;

mod common;

use common::{assert_close, golden_path};

#[derive(Debug, Deserialize)]
struct Golden {
    #[serde(rename = "aggregateInput")]
    aggregate_input: Vec<InputBattle>,
    aggregate: Vec<ExpectedAggregate>,
}

#[derive(Debug, Deserialize)]
struct InputBattle {
    #[serde(rename = "winnerTeam")]
    winner_team: i64,
    #[serde(rename = "startTime")]
    start_time: i64,
    #[serde(rename = "durationSec")]
    duration_sec: Option<f64>,
    players: Vec<InputParticipant>,
}

#[derive(Debug, Deserialize)]
struct InputParticipant {
    #[serde(rename = "accountId")]
    account_id: String,
    team: i64,
    nickname: Option<String>,
    clan: Option<String>,
    #[serde(rename = "vehicleId")]
    vehicle_id: String,
    #[serde(rename = "damageDealt")]
    damage_dealt: i64,
    #[serde(rename = "damageAssisted")]
    damage_assisted: i64,
    #[serde(rename = "damageBlocked")]
    damage_blocked: i64,
    #[serde(rename = "damageReceived")]
    damage_received: i64,
    kills: i64,
    shots: i64,
    #[serde(rename = "hitsDealt")]
    hits_dealt: i64,
    #[serde(rename = "penetrationsDealt")]
    penetrations_dealt: i64,
    #[serde(rename = "enemiesDamaged")]
    enemies_damaged: i64,
    #[serde(rename = "victoryPointsEarned")]
    victory_points_earned: i64,
    survived: bool,
    #[serde(rename = "lifeTimeSec")]
    life_time_sec: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct ExpectedAggregate {
    #[serde(rename = "accountId")]
    account_id: String,
    nickname: String,
    clan: String,
    team: i64,
    battles: i64,
    wins: i64,
    survived: i64,
    kills: i64,
    damage: i64,
    assisted: i64,
    received: i64,
    blocked: i64,
    earned: i64,
    shots: i64,
    hits: i64,
    pens: i64,
    #[serde(rename = "enemiesDamaged")]
    enemies_damaged: i64,
    #[serde(rename = "survivalSum")]
    survival_sum: f64,
    #[serde(rename = "survivalKnownBattles")]
    survival_known_battles: i64,
    #[serde(rename = "winRate")]
    win_rate: f64,
    #[serde(rename = "survivalRate")]
    survival_rate: f64,
    #[serde(rename = "damageAvg")]
    damage_avg: f64,
    #[serde(rename = "assistedAvg")]
    assisted_avg: f64,
    #[serde(rename = "receivedAvg")]
    received_avg: f64,
    #[serde(rename = "blockedAvg")]
    blocked_avg: f64,
    #[serde(rename = "killsAvg")]
    kills_avg: f64,
    #[serde(rename = "earnedAvg")]
    earned_avg: f64,
    #[serde(rename = "survivalTimeAvg")]
    survival_time_avg: Option<f64>,
    #[serde(rename = "hitRate")]
    hit_rate: Option<f64>,
    #[serde(rename = "penRate")]
    pen_rate: Option<f64>,
    #[serde(rename = "vehicleUsage")]
    vehicle_usage: Vec<ExpectedVehicleUsage>,
}

/// Structured vehicle usage from the Java oracle (`Agg.vehicleUsage()`, key `tanks`).
#[derive(Debug, Deserialize)]
struct ExpectedVehicleUsage {
    #[serde(rename = "tankId")]
    tank_id: String,
    battles: i64,
}

fn to_battle(input: &InputBattle) -> BattleResult {
    BattleResult {
        arena_id: "golden".to_string(),
        game_version: None,
        battle_time: Some(input.start_time),
        duration_sec: input.duration_sec,
        settlement_duration_sec: input.duration_sec,
        settlement_finish_reason_raw: None,
        battle_mode: None,
        map: None,
        recorder_vehicle: None,
        winner_team: Some(input.winner_team),
        roster_len: input.players.len(),
        roster_complete: true,
        participants: input
            .players
            .iter()
            .map(|player| ParticipantResult {
                participant_ref: player.account_id.clone(),
                game_account_id: player.account_id.clone(),
                nickname: player.nickname.clone(),
                clan: player.clan.clone(),
                team: Some(player.team),
                vehicle_id: Some(player.vehicle_id.clone()),
                damage_dealt: Some(player.damage_dealt),
                damage_assisted: Some(player.damage_assisted),
                damage_received: Some(player.damage_received),
                damage_blocked: Some(player.damage_blocked),
                kills: Some(player.kills),
                shots: Some(player.shots),
                hits_dealt: Some(player.hits_dealt),
                penetrations_dealt: Some(player.penetrations_dealt),
                hits_received: None,
                penetrations_received: None,
                enemies_damaged: Some(player.enemies_damaged),
                survived: player.survived,
                settlement_life_time_sec: player
                    .life_time_sec
                    .map(|seconds| seconds.round() as i64),
                death_reason_raw: None,
                killer_account_id: None,
                victory_points_earned: Some(player.victory_points_earned),
                victory_points_seized: None,
            })
            .collect(),
        quality: ParseQuality::default(),
    }
}

#[test]
fn aggregate_matches_the_java_golden() {
    let path = golden_path();
    let raw = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("cannot read golden {}: {e}", path.display()));
    let golden: Golden = serde_json::from_str(&raw).expect("golden is valid JSON");
    assert!(
        !golden.aggregate.is_empty(),
        "golden must contain aggregates"
    );

    let battles: Vec<BattleResult> = golden.aggregate_input.iter().map(to_battle).collect();
    let actual = aggregate(&battles);
    assert_eq!(
        actual.len(),
        golden.aggregate.len(),
        "aggregate must cover exactly the golden accounts"
    );

    for expected in &golden.aggregate {
        let entry = actual
            .iter()
            .find(|a| a.account_id == expected.account_id)
            .unwrap_or_else(|| panic!("missing aggregate for {}", expected.account_id));
        let label = format!("aggregate {}", expected.account_id);

        assert_eq!(entry.nickname, expected.nickname, "{label} nickname");
        assert_eq!(entry.clan, expected.clan, "{label} clan");
        assert_eq!(entry.team, expected.team, "{label} team");
        assert_eq!(entry.battles, expected.battles, "{label} battles");
        assert_eq!(entry.wins, expected.wins, "{label} wins");
        assert_eq!(entry.survived, expected.survived, "{label} survived");
        assert_eq!(entry.kills, expected.kills, "{label} kills");
        assert_eq!(entry.damage, expected.damage, "{label} damage");
        assert_eq!(entry.assisted, expected.assisted, "{label} assisted");
        assert_eq!(entry.received, expected.received, "{label} received");
        assert_eq!(entry.blocked, expected.blocked, "{label} blocked");
        assert_eq!(entry.earned, expected.earned, "{label} earned");
        assert_eq!(entry.shots, expected.shots, "{label} shots");
        assert_eq!(entry.hits, expected.hits, "{label} hits");
        assert_eq!(entry.penetrations, expected.pens, "{label} penetrations");
        assert_eq!(
            entry.enemies_damaged, expected.enemies_damaged,
            "{label} enemies damaged"
        );
        assert_close(
            entry.survival_sum,
            expected.survival_sum,
            &format!("{label} survival sum"),
        );
        assert_eq!(
            entry.survival_known_battles, expected.survival_known_battles,
            "{label} survival known battles"
        );
        assert_close(
            entry.win_rate(),
            expected.win_rate,
            &format!("{label} win rate"),
        );
        assert_close(
            entry.survival_rate(),
            expected.survival_rate,
            &format!("{label} survival rate"),
        );
        assert_close(
            entry.average(entry.damage as f64),
            expected.damage_avg,
            &format!("{label} damage avg"),
        );
        assert_close(
            entry.average(entry.assisted as f64),
            expected.assisted_avg,
            &format!("{label} assisted avg"),
        );
        assert_close(
            entry.average(entry.received as f64),
            expected.received_avg,
            &format!("{label} received avg"),
        );
        assert_close(
            entry.average(entry.blocked as f64),
            expected.blocked_avg,
            &format!("{label} blocked avg"),
        );
        assert_close(
            entry.average(entry.kills as f64),
            expected.kills_avg,
            &format!("{label} kills avg"),
        );
        assert_close(
            entry.average(entry.earned as f64),
            expected.earned_avg,
            &format!("{label} earned avg"),
        );
        match (entry.survival_time_avg(), expected.survival_time_avg) {
            (None, None) => {}
            (Some(actual), Some(expected_value)) => assert_close(
                actual,
                expected_value,
                &format!("{label} survival average (survival_avg -> survival_time_avg)"),
            ),
            (actual, expected_value) => {
                panic!("{label} survival average availability: {actual:?} vs {expected_value:?}")
            }
        }
        // Derived ratios use the shared tolerance: Java and Rust may round the last bit differently
        // (1 ULP on `100 × hits / shots`), which is not a semantic divergence. The counters they are
        // derived from are compared exactly above.
        match (entry.hit_rate(), expected.hit_rate) {
            (None, None) => {}
            (Some(actual), Some(expected_value)) => {
                assert_close(actual, expected_value, &format!("{label} hit rate"))
            }
            (actual, expected_value) => {
                panic!("{label} hit rate availability: {actual:?} vs {expected_value:?}")
            }
        }
        match (entry.penetration_rate(), expected.pen_rate) {
            (None, None) => {}
            (Some(actual), Some(expected_value)) => {
                assert_close(actual, expected_value, &format!("{label} penetration rate"))
            }
            (actual, expected_value) => {
                panic!("{label} penetration rate availability: {actual:?} vs {expected_value:?}")
            }
        }

        // Vehicle usage replaces the deleted tank-name column: every battle is attributed once and
        // the structured (vehicleId, battles) list matches the Java oracle entry for entry
        // (same canonical order: battles desc, then decimal vehicle id asc).
        let vehicle_total: i64 = entry.vehicle_usage.iter().map(|usage| usage.battles).sum();
        assert_eq!(
            vehicle_total, entry.battles,
            "{label} vehicle usage must cover every battle"
        );
        assert!(
            entry
                .vehicle_usage
                .iter()
                .all(|usage| !usage.vehicle_id.is_empty()),
            "{label} vehicle ids must not be empty"
        );
        let actual_usage: Vec<(String, i64)> = entry
            .vehicle_usage
            .iter()
            .map(|usage| (usage.vehicle_id.clone(), usage.battles))
            .collect();
        let expected_usage: Vec<(String, i64)> = expected
            .vehicle_usage
            .iter()
            .map(|usage| (usage.tank_id.clone(), usage.battles))
            .collect();
        assert_eq!(
            actual_usage, expected_usage,
            "{label} structured vehicle usage must match the Java oracle"
        );
    }
}
