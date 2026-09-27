//! League Rating: V4.1 single battle + V6 batch projection.
//!
//! Ports `com.wotb.core.rating.{LeagueRatingCalculator,LeagueRatingNormalizer,LeagueBatchRatingCalculator}`
//! and `com.wotb.core.replay.facts.TradeFacts` without touching any formula, weight, cap or
//! normalization. The frozen spec is `docs/features/league-rating.md:92-162` (single battle) and
//! `docs/WotBTools_League_Rating_V6.md` (batch).
//!
//! A `PlayerRating` deliberately carries **only** the rating outcome (seven dimensions, the two
//! intermediate sums, the survival state and the MVP flags). The tie-break keys the MVP comparator
//! needs (raw damage/assist/kills, team, account id) stay on the input side, so the rating object is
//! not a second copy of the battle facts.

pub mod batch;
pub mod eligibility;
pub mod league;
pub mod normalizer;
pub mod trade;

pub use league::{
    classify, is_league, team_auto_name, team_name_source, LeagueRatingMode,
    ARENA_BONUS_TYPE_TOURNAMENT, ARENA_BONUS_TYPE_TRAINING, MAJORITY_THRESHOLD,
    NAME_SOURCE_CLAN_MAJORITY, NAME_SOURCE_UNNAMED,
};

pub use batch::{
    observed_mean, player_batch_rating, require_observation, team_batch_rating, BatchRatingError,
    PLAYER_PRIOR_WEIGHT, TEAM_PRIOR_WEIGHT, V6_ANCHOR,
};
pub use eligibility::{
    consistent, fingerprint, first_failure_code, validate, validate_copies, LeagueFailure,
    CODE_ARENA_ID_MISSING, CODE_CONFLICTING_REPLAYS_FOR_ARENA, CODE_DUPLICATE_ACCOUNT_ID,
    CODE_INVALID_STAT_FACTS, CODE_INVALID_TEAM, CODE_MISSING_TANK, CODE_NOT_SEVEN_VS_SEVEN,
    CODE_NO_DECISIVE_WINNER,
};
pub use normalizer::{
    finite_positive, global_index, team_index, wilson_lower_bound, TOTAL_PLAYERS, WILSON_Z,
};
pub use trade::{death_sec, traded_deaths, TRADE_AFTER_DEATH_WINDOW_SEC};

use serde::{Deserialize, Serialize};

use crate::result::ParticipantResult;

/// Frozen dimension maxima (V4.1, sum = 1000).
pub const MAX_DAMAGE: f64 = 365.0;
pub const MAX_ASSIST: f64 = 110.0;
pub const MAX_KILL: f64 = 110.0;
pub const MAX_EXCHANGE: f64 = 180.0;
pub const MAX_BLOCKED: f64 = 50.0;
pub const MAX_SURVIVAL_TRADE: f64 = 75.0;
pub const MAX_SHOOTING: f64 = 110.0;
/// Final rating cap.
pub const MAX_FINAL: f64 = 1000.0;

/// Seven dimensions, in the canonical order shared with `LeagueColumns.DIM_KEYS`.
pub const DIMENSION_KEYS: [&str; 7] = [
    "league_damage_score",
    "league_assist_score",
    "league_kill_score",
    "league_exchange_score",
    "league_blocked_score",
    "league_survival_score",
    "league_shooting_score",
];

/// Frozen dimension maxima aligned with [`DIMENSION_KEYS`].
pub const DIMENSION_MAX: [f64; 7] = [
    MAX_DAMAGE,
    MAX_ASSIST,
    MAX_KILL,
    MAX_EXCHANGE,
    MAX_BLOCKED,
    MAX_SURVIVAL_TRADE,
    MAX_SHOOTING,
];

/// `[teamWeight, globalWeight]` for damage / assist / kill / exchange / blocked.
const DIM_WEIGHTS: [[f64; 2]; 5] = [
    [0.60, 0.40],
    [0.70, 0.30],
    [0.40, 0.60],
    [0.30, 0.70],
    [0.70, 0.30],
];

/// Frozen survival/trade score for a traded death.
const RC_TRADE: f64 = 50.0;

/// Index of the RC (survival/trade) dimension inside the dimension array.
const RC_INDEX: usize = 5;

/// Survival state in the stable English codes of the production contract.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum SurvivalState {
    WinSurvived,
    Trade,
    None,
}

impl SurvivalState {
    pub fn code(self) -> &'static str {
        match self {
            SurvivalState::WinSurvived => "WIN_SURVIVED",
            SurvivalState::Trade => "TRADE",
            SurvivalState::None => "NONE",
        }
    }
}

/// Rating input for one settled combatant.
///
/// Missing settlement numbers are `0`, matching the production protobuf policy (an absent field and
/// a real zero are indistinguishable on the wire).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct RatingPlayer {
    pub account_id: String,
    pub nickname: Option<String>,
    pub clan: Option<String>,
    pub team: i64,
    pub damage_dealt: i64,
    pub damage_assisted: i64,
    pub damage_blocked: i64,
    pub damage_received: i64,
    pub kills: i64,
    pub shots: i64,
    pub hits_dealt: i64,
    pub penetrations_dealt: i64,
    pub survived: bool,
    pub settlement_life_time_sec: Option<i64>,
}

impl RatingPlayer {
    /// Projects a parsed settlement participant into rating input.
    pub fn from_participant(participant: &ParticipantResult) -> Self {
        fn value(field: Option<i64>) -> i64 {
            field.unwrap_or(0)
        }
        Self {
            account_id: participant.game_account_id.clone(),
            nickname: participant.nickname.clone(),
            clan: participant.clan.clone(),
            team: participant.team.unwrap_or(0),
            damage_dealt: value(participant.damage_dealt),
            damage_assisted: value(participant.damage_assisted),
            damage_blocked: value(participant.damage_blocked),
            damage_received: value(participant.damage_received),
            kills: value(participant.kills),
            shots: value(participant.shots),
            hits_dealt: value(participant.hits_dealt),
            penetrations_dealt: value(participant.penetrations_dealt),
            survived: participant.survived,
            settlement_life_time_sec: participant.settlement_life_time_sec,
        }
    }
}

/// One player's single-battle rating.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlayerRating {
    pub account_id: String,
    pub team: i64,
    /// Seven dimension scores in [`DIMENSION_KEYS`] order.
    pub dimensions: [f64; 7],
    /// Sum of the six non-RC dimensions (no survival score, no winner multiplier).
    pub preliminary: f64,
    /// `preliminary + survival`.
    pub base_rating: f64,
    /// Winner `min(1000, base × 1.05)`, loser `base`.
    pub final_rating: f64,
    pub survival_state: SurvivalState,
    pub mvp: bool,
    pub team_best: bool,
}

/// One team's single-battle rating.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TeamRating {
    pub team: i64,
    /// Arithmetic mean of the team members' `final_rating`.
    pub rating: f64,
    pub dimension_averages: [f64; 7],
    pub best_account_id: Option<String>,
}

/// Result of rating one battle.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BattleRating {
    pub arena_id: String,
    pub winner_team: i64,
    pub players: Vec<PlayerRating>,
    /// Team 1 and team 2, in that order.
    pub teams: [TeamRating; 2],
    pub mvp_account_id: Option<String>,
}

/// Rates one already-validated 7v7 battle.
///
/// Eligibility (14 settled combatants, decisive winner, positive vehicle ids) is the validator's
/// job, not this function's: the formula must stay a pure projection of the facts it is given.
pub fn rate_battle(arena_id: &str, winner_team: i64, players: &[RatingPlayer]) -> BattleRating {
    let count = players.len();
    let team_avg_damage = team_averages(players, |p| p.damage_dealt as f64);
    let team_avg_assist = team_averages(players, |p| p.damage_assisted as f64);
    let team_avg_kills = team_averages(players, |p| p.kills as f64);
    let team_avg_blocked = team_averages(players, |p| p.damage_blocked as f64);
    let team_avg_output = team_averages(players, effective_output);

    let all_damage: Vec<f64> = players.iter().map(|p| p.damage_dealt as f64).collect();
    let all_assist: Vec<f64> = players.iter().map(|p| p.damage_assisted as f64).collect();
    let all_kills: Vec<f64> = players.iter().map(|p| p.kills as f64).collect();
    let all_blocked: Vec<f64> = players.iter().map(|p| p.damage_blocked as f64).collect();

    let mut dimensions = vec![[0.0f64; 7]; count];
    let mut exchange_efficiency = vec![0.0f64; count];
    let mut all_exchange: Vec<f64> = Vec::with_capacity(count);

    for (index, player) in players.iter().enumerate() {
        let team = team_slot(player.team);
        dimensions[index][0] = dim(
            MAX_DAMAGE,
            DIM_WEIGHTS[0],
            team_index(player.damage_dealt as f64, team_avg_damage[team]),
            global_index(player.damage_dealt as f64, &all_damage),
        );
        dimensions[index][1] = dim(
            MAX_ASSIST,
            DIM_WEIGHTS[1],
            team_index(player.damage_assisted as f64, team_avg_assist[team]),
            global_index(player.damage_assisted as f64, &all_assist),
        );
        dimensions[index][2] = dim(
            MAX_KILL,
            DIM_WEIGHTS[2],
            team_index(player.kills as f64, team_avg_kills[team]),
            global_index(player.kills as f64, &all_kills),
        );
        dimensions[index][4] = dim(
            MAX_BLOCKED,
            DIM_WEIGHTS[4],
            team_index(player.damage_blocked as f64, team_avg_blocked[team]),
            global_index(player.damage_blocked as f64, &all_blocked),
        );

        // Exchange efficiency: O/(O+received) × participation, participation capped at 1.
        let output = effective_output(player);
        let participation = if finite_positive(team_avg_output[team]) {
            (output / team_avg_output[team]).min(1.0)
        } else {
            0.0
        };
        let denominator = output + player.damage_received as f64;
        exchange_efficiency[index] = if denominator <= 0.0 {
            0.0
        } else {
            (output / denominator) * participation
        };
        all_exchange.push(exchange_efficiency[index]);

        // Shooting: Soft Wilson (90% lower bound + 10% raw), 30/70 hit/penetration split, times
        // damage participation.
        let soft_accuracy = 0.90
            * wilson_lower_bound(player.hits_dealt as f64, player.shots as f64)
            + 0.10 * raw_rate(player.hits_dealt as f64, player.shots as f64);
        let soft_penetration = 0.90
            * wilson_lower_bound(player.penetrations_dealt as f64, player.hits_dealt as f64)
            + 0.10 * raw_rate(player.penetrations_dealt as f64, player.hits_dealt as f64);
        let confidence = 0.30 * soft_accuracy + 0.70 * soft_penetration;
        let damage_participation = if finite_positive(team_avg_damage[team]) {
            (player.damage_dealt as f64 / team_avg_damage[team]).min(1.0)
        } else {
            0.0
        };
        dimensions[index][6] = MAX_SHOOTING * (confidence / 0.70).min(1.0) * damage_participation;
    }

    // The exchange team average needs every exchange efficiency first.
    let team_avg_exchange = averages_of(&exchange_efficiency, players);

    let mut ratings: Vec<PlayerRating> = Vec::with_capacity(count);
    for (index, player) in players.iter().enumerate() {
        dimensions[index][3] = dim(
            MAX_EXCHANGE,
            DIM_WEIGHTS[3],
            team_index(
                exchange_efficiency[index],
                team_avg_exchange[team_slot(player.team)],
            ),
            global_index(exchange_efficiency[index], &all_exchange),
        );

        let preliminary: f64 = dimensions[index]
            .iter()
            .enumerate()
            .filter(|(position, _)| *position != RC_INDEX)
            .map(|(_, score)| *score)
            .sum();

        let won = player.team == winner_team;
        let (survival, state) = if won && player.survived {
            (MAX_SURVIVAL_TRADE, SurvivalState::WinSurvived)
        } else if !player.survived && traded_deaths(player, players) > 0 {
            (RC_TRADE, SurvivalState::Trade)
        } else {
            (0.0, SurvivalState::None)
        };
        dimensions[index][RC_INDEX] = survival;

        let base_rating = preliminary + survival;
        let final_rating = if won {
            MAX_FINAL.min(base_rating * 1.05)
        } else {
            base_rating
        };

        ratings.push(PlayerRating {
            account_id: player.account_id.clone(),
            team: player.team,
            dimensions: dimensions[index],
            preliminary,
            base_rating,
            final_rating,
            survival_state: state,
            mvp: false,
            team_best: false,
        });
    }

    // MVP then team best, with the frozen tie-break order.
    let mvp_index = best_index(&ratings, players, winner_team, None);
    if let Some(index) = mvp_index {
        ratings[index].mvp = true;
    }
    for team in [1i64, 2i64] {
        if let Some(index) = best_index(&ratings, players, winner_team, Some(team)) {
            ratings[index].team_best = true;
        }
    }

    let teams = [
        team_rating(1, &ratings, players, winner_team),
        team_rating(2, &ratings, players, winner_team),
    ];

    BattleRating {
        arena_id: arena_id.to_string(),
        winner_team,
        mvp_account_id: mvp_index.map(|index| ratings[index].account_id.clone()),
        players: ratings,
        teams,
    }
}

/// `componentMax × (teamWeight × T + globalWeight × G)`, clamped into `[0, max]`.
fn dim(max: f64, weights: [f64; 2], team_index_value: f64, global_index_value: f64) -> f64 {
    clamp_score(
        max * (weights[0] * team_index_value + weights[1] * global_index_value),
        max,
    )
}

/// `clamp(v, max)` with the production zero rule: non-finite or `<= 0` becomes 0.
fn clamp_score(value: f64, max: f64) -> f64 {
    if value.is_nan() || value.is_infinite() || value <= 0.0 {
        return 0.0;
    }
    max.min(value)
}

/// Effective output `O = damage + 0.60 × assist + 0.35 × blocked`.
fn effective_output(player: &RatingPlayer) -> f64 {
    player.damage_dealt as f64
        + 0.60 * player.damage_assisted as f64
        + 0.35 * player.damage_blocked as f64
}

/// Raw ratio clamped to `[0, 1]`, zero-safe for non-positive inputs.
fn raw_rate(successes: f64, trials: f64) -> f64 {
    if !successes.is_finite() || !trials.is_finite() || trials <= 0.0 || successes <= 0.0 {
        return 0.0;
    }
    (successes / trials).clamp(0.0, 1.0)
}

/// Per-team averages of a derived value, indexed by team slot (`[0]` unused).
fn team_averages(players: &[RatingPlayer], getter: impl Fn(&RatingPlayer) -> f64) -> [f64; 3] {
    let mut sums = [0.0f64; 3];
    let mut counts = [0i64; 3];
    for player in players {
        let slot = team_slot(player.team);
        if slot != 0 {
            sums[slot] += getter(player);
            counts[slot] += 1;
        }
    }
    [
        0.0,
        if counts[1] == 0 {
            0.0
        } else {
            sums[1] / counts[1] as f64
        },
        if counts[2] == 0 {
            0.0
        } else {
            sums[2] / counts[2] as f64
        },
    ]
}

/// Per-team averages of an already computed value slice (same order as `players`).
fn averages_of(values: &[f64], players: &[RatingPlayer]) -> [f64; 3] {
    let mut sums = [0.0f64; 3];
    let mut counts = [0i64; 3];
    for (player, value) in players.iter().zip(values.iter()) {
        let slot = team_slot(player.team);
        if slot != 0 {
            sums[slot] += *value;
            counts[slot] += 1;
        }
    }
    [
        0.0,
        if counts[1] == 0 {
            0.0
        } else {
            sums[1] / counts[1] as f64
        },
        if counts[2] == 0 {
            0.0
        } else {
            sums[2] / counts[2] as f64
        },
    ]
}

/// Maps a team number to an array slot, keeping only the two real teams.
fn team_slot(team: i64) -> usize {
    match team {
        1 => 1,
        2 => 2,
        _ => 0,
    }
}

/// Best player index by the frozen order: `finalRating → winner first → damage → assist → kills →
/// accountId`. Ties keep the first candidate, matching the production `max` semantics.
fn best_index(
    ratings: &[PlayerRating],
    players: &[RatingPlayer],
    winner_team: i64,
    team_filter: Option<i64>,
) -> Option<usize> {
    let mut best: Option<usize> = None;
    for (index, rating) in ratings.iter().enumerate() {
        if let Some(team) = team_filter {
            if rating.team != team {
                continue;
            }
        }
        best = match best {
            None => Some(index),
            Some(current) => {
                if is_better(index, current, ratings, players, winner_team) {
                    Some(index)
                } else {
                    Some(current)
                }
            }
        };
    }
    best
}

fn is_better(
    candidate: usize,
    current: usize,
    ratings: &[PlayerRating],
    players: &[RatingPlayer],
    winner_team: i64,
) -> bool {
    let a = &ratings[candidate];
    let b = &ratings[current];
    match a
        .final_rating
        .partial_cmp(&b.final_rating)
        .unwrap_or(std::cmp::Ordering::Equal)
    {
        std::cmp::Ordering::Greater => return true,
        std::cmp::Ordering::Less => return false,
        std::cmp::Ordering::Equal => {}
    }
    let a_won = a.team == winner_team;
    let b_won = b.team == winner_team;
    if a_won != b_won {
        return a_won;
    }
    let (pa, pb) = (&players[candidate], &players[current]);
    if pa.damage_dealt != pb.damage_dealt {
        return pa.damage_dealt > pb.damage_dealt;
    }
    if pa.damage_assisted != pb.damage_assisted {
        return pa.damage_assisted > pb.damage_assisted;
    }
    if pa.kills != pb.kills {
        return pa.kills > pb.kills;
    }
    pa.account_id > pb.account_id
}

/// Team rating: plain mean of the members' final ratings plus dimension averages.
fn team_rating(
    team: i64,
    ratings: &[PlayerRating],
    players: &[RatingPlayer],
    winner_team: i64,
) -> TeamRating {
    let members: Vec<&PlayerRating> = ratings.iter().filter(|r| r.team == team).collect();
    if members.is_empty() {
        return TeamRating {
            team,
            rating: 0.0,
            dimension_averages: [0.0; 7],
            best_account_id: None,
        };
    }
    let count = members.len() as f64;
    let rating = members.iter().map(|r| r.final_rating).sum::<f64>() / count;
    // Sum first, then divide once: the same floating-point order as the production calculator.
    let mut dimension_sums = [0.0f64; 7];
    for member in &members {
        for (position, score) in member.dimensions.iter().enumerate() {
            dimension_sums[position] += score;
        }
    }
    let dimension_averages = dimension_sums.map(|sum| sum / count);
    TeamRating {
        team,
        rating,
        dimension_averages,
        best_account_id: best_index(ratings, players, winner_team, Some(team))
            .map(|index| ratings[index].account_id.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn player(team: i64, account: &str) -> RatingPlayer {
        RatingPlayer {
            account_id: account.to_string(),
            team,
            ..RatingPlayer::default()
        }
    }

    fn seven_per_team() -> Vec<RatingPlayer> {
        let mut players = Vec::new();
        for team in [1i64, 2i64] {
            for seat in 0..7 {
                let mut entry = player(team, &format!("{team}{seat}"));
                entry.damage_dealt = 1000 + seat as i64 * 100;
                entry.damage_assisted = 100;
                entry.damage_received = 800;
                entry.damage_blocked = 200;
                entry.kills = seat as i64 % 3;
                entry.shots = 10;
                entry.hits_dealt = 7;
                entry.penetrations_dealt = 5;
                entry.survived = seat == 6;
                entry.settlement_life_time_sec = Some(60 + seat as i64 * 10);
                players.push(entry);
            }
        }
        players
    }

    #[test]
    fn dimension_maxima_sum_to_one_thousand() {
        assert_eq!(DIMENSION_MAX.iter().sum::<f64>(), 1000.0);
        assert_eq!(DIMENSION_KEYS.len(), DIMENSION_MAX.len());
    }

    #[test]
    fn winner_multiplier_is_capped_and_losers_are_not_penalised() {
        let players = seven_per_team();
        let rating = rate_battle("arena", 1, &players);
        for entry in &rating.players {
            assert!(
                entry.final_rating <= MAX_FINAL,
                "final rating must stay capped"
            );
            if entry.team == 1 {
                assert!(
                    (entry.final_rating - (entry.base_rating * 1.05).min(MAX_FINAL)).abs() < 1e-9
                );
            } else {
                assert!((entry.final_rating - entry.base_rating).abs() < 1e-9);
            }
            assert!(
                (entry.base_rating - (entry.preliminary + entry.dimensions[RC_INDEX])).abs() < 1e-9
            );
        }
    }

    #[test]
    fn survivor_on_the_winning_team_gets_the_frozen_survival_score() {
        let players = seven_per_team();
        let rating = rate_battle("arena", 1, &players);
        let winner_survivor = rating
            .players
            .iter()
            .find(|p| p.team == 1 && p.account_id == "16")
            .expect("winner survivor");
        assert_eq!(winner_survivor.survival_state, SurvivalState::WinSurvived);
        assert_eq!(winner_survivor.dimensions[RC_INDEX], MAX_SURVIVAL_TRADE);

        let loser_survivor = rating
            .players
            .iter()
            .find(|p| p.team == 2 && p.account_id == "26")
            .expect("loser survivor");
        assert_eq!(loser_survivor.survival_state, SurvivalState::None);
        assert_eq!(loser_survivor.dimensions[RC_INDEX], 0.0);
    }

    #[test]
    fn mvp_is_unique_and_team_best_is_per_team() {
        let players = seven_per_team();
        let rating = rate_battle("arena", 1, &players);
        assert_eq!(rating.players.iter().filter(|p| p.mvp).count(), 1);
        assert_eq!(rating.players.iter().filter(|p| p.team_best).count(), 2);
        let mvp = rating.mvp_account_id.clone().expect("mvp");
        assert!(rating
            .players
            .iter()
            .any(|p| p.account_id == mvp && p.mvp && p.team_best));
        for team in [1i64, 2i64] {
            let team_rating = rating
                .teams
                .iter()
                .find(|t| t.team == team)
                .expect("team rating");
            assert!(team_rating.best_account_id.is_some());
            let members: Vec<&PlayerRating> =
                rating.players.iter().filter(|p| p.team == team).collect();
            let mean = members.iter().map(|p| p.final_rating).sum::<f64>() / members.len() as f64;
            assert!((team_rating.rating - mean).abs() < 1e-9);
        }
    }

    #[test]
    fn zero_statistics_do_not_divide_by_zero_or_score_anyone() {
        let players: Vec<RatingPlayer> = (0..14)
            .map(|index| player(if index < 7 { 1 } else { 2 }, &format!("p{index}")))
            .collect();
        let rating = rate_battle("arena", 1, &players);
        for entry in &rating.players {
            assert_eq!(entry.preliminary, 0.0);
            assert_eq!(entry.final_rating, 0.0);
            assert_eq!(entry.dimensions.iter().sum::<f64>(), 0.0);
        }
    }
}
