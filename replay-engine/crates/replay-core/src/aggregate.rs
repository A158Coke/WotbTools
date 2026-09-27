//! Cross-battle aggregate statistics (`Aggregator` / `Agg`).
//!
//! Ports `com.wotb.core.stats.Aggregator` and `com.wotb.core.model.Agg` value-for-value, with one
//! approved change: the `tanks` column is no longer a tankopedia-name-joined string. Vehicle usage
//! is structured (`vehicle_id` + battles), which is what the product actually consumes
//! (`docs/current-plan.md` §11.4, B6); the tank name belongs to Tank Knowledge, not to the engine.
//!
//! Rate semantics are fail-closed exactly like production: `survival_time_avg` is unavailable unless
//! **every** aggregated battle has a provable survival/death second, and `hit_rate`/`penetration_rate`
//! are unavailable (not `0%`) when their denominator is zero.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::result::BattleResult;

/// Structured vehicle usage for one player.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct VehicleUsage {
    pub vehicle_id: String,
    pub battles: i64,
}

/// One player's accumulated statistics.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Aggregate {
    pub account_id: String,
    pub nickname: String,
    pub clan: String,
    /// Team of the most recent battle (UI row tint only).
    pub team: i64,
    pub battles: i64,
    pub wins: i64,
    pub survived: i64,
    pub kills: i64,
    pub damage: i64,
    pub assisted: i64,
    pub received: i64,
    pub blocked: i64,
    /// Objective victory points earned (not part of any Rating dimension).
    pub earned: i64,
    pub shots: i64,
    pub hits: i64,
    pub penetrations: i64,
    pub enemies_damaged: i64,
    /// Sum of provable survival/death seconds; unknown battles never contribute a fake zero.
    pub survival_sum: f64,
    pub survival_known_battles: i64,
    /// Structured vehicle usage, sorted by battles (desc) then vehicle id (asc).
    pub vehicle_usage: Vec<VehicleUsage>,
}

impl Aggregate {
    pub fn win_rate(&self) -> f64 {
        if self.battles == 0 {
            0.0
        } else {
            100.0 * self.wins as f64 / self.battles as f64
        }
    }

    pub fn survival_rate(&self) -> f64 {
        if self.battles == 0 {
            0.0
        } else {
            100.0 * self.survived as f64 / self.battles as f64
        }
    }

    /// Per-battle average of an accumulated total.
    pub fn average(&self, total: f64) -> f64 {
        if self.battles == 0 {
            0.0
        } else {
            total / self.battles as f64
        }
    }

    /// Average survival time; `None` while any aggregated battle lacks a provable second.
    pub fn survival_time_avg(&self) -> Option<f64> {
        if self.battles > 0 && self.survival_known_battles == self.battles {
            Some(self.survival_sum / self.battles as f64)
        } else {
            None
        }
    }

    /// `hits / shots` on a 0-100 scale; `None` when nothing was fired.
    pub fn hit_rate(&self) -> Option<f64> {
        if self.shots == 0 {
            None
        } else {
            Some(100.0 * self.hits as f64 / self.shots as f64)
        }
    }

    /// `penetrations / hits` on a 0-100 scale; the denominator is hits, not shots.
    pub fn penetration_rate(&self) -> Option<f64> {
        if self.hits == 0 {
            None
        } else {
            Some(100.0 * self.penetrations as f64 / self.hits as f64)
        }
    }
}

/// Aggregates battles per account, preserving first-appearance order.
pub fn aggregate(results: &[BattleResult]) -> Vec<Aggregate> {
    let mut index: HashMap<String, usize> = HashMap::new();
    let mut accumulator: Vec<Accumulator> = Vec::new();

    for battle in results {
        let winner = battle.winner_team;
        let start = battle.battle_time.unwrap_or(0);
        for participant in &battle.participants {
            let account_id = participant.game_account_id.clone();
            let slot = match index.get(&account_id) {
                Some(existing) => *existing,
                None => {
                    index.insert(account_id.clone(), accumulator.len());
                    accumulator.push(Accumulator::new(account_id));
                    accumulator.len() - 1
                }
            };
            let entry = &mut accumulator[slot];

            // The most recent battle owns the display identity.
            if start >= entry.last_time {
                entry.last_time = start;
                entry.nickname = match participant.nickname.as_deref() {
                    Some(name) if !name.trim().is_empty() => name.to_string(),
                    _ => entry.account_id.clone(),
                };
                entry.clan = participant.clan.clone().unwrap_or_default();
                entry.team = participant.team.unwrap_or(0);
            }

            entry.battles += 1;
            if let Some(winner) = winner.filter(|value| *value != 0) {
                if participant.team == Some(winner) {
                    entry.wins += 1;
                }
            }
            if participant.survived {
                entry.survived += 1;
            }
            let survival_seconds = canonical_survival_seconds(
                battle,
                participant.survived,
                participant.settlement_life_time_sec,
            );
            if survival_seconds > 0.0 {
                entry.survival_sum += survival_seconds;
                entry.survival_known_battles += 1;
            }

            entry.kills += value(participant.kills);
            entry.damage += value(participant.damage_dealt);
            entry.assisted += value(participant.damage_assisted);
            entry.received += value(participant.damage_received);
            entry.blocked += value(participant.damage_blocked);
            entry.shots += value(participant.shots);
            entry.hits += value(participant.hits_dealt);
            entry.penetrations += value(participant.penetrations_dealt);
            entry.enemies_damaged += value(participant.enemies_damaged);
            entry.earned += value(participant.victory_points_earned);

            if let Some(vehicle_id) = participant.vehicle_id.as_deref() {
                if !vehicle_id.is_empty() {
                    *entry.vehicles.entry(vehicle_id.to_string()).or_insert(0) += 1;
                }
            }
        }
    }

    accumulator.into_iter().map(Accumulator::finish).collect()
}

/// Survival seconds: survivors use the battle duration, the dead use the settlement death second.
/// `0` means "not provable" and is never added to the sum.
fn canonical_survival_seconds(
    battle: &BattleResult,
    survived: bool,
    settlement_life_time_sec: Option<i64>,
) -> f64 {
    if survived {
        return match battle.duration_sec {
            Some(duration) if duration > 0.0 => duration,
            _ => 0.0,
        };
    }
    match settlement_life_time_sec {
        Some(seconds) if seconds > 0 => seconds as f64,
        _ => 0.0,
    }
}

fn value(field: Option<i64>) -> i64 {
    field.unwrap_or(0)
}

struct Accumulator {
    account_id: String,
    last_time: i64,
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
    penetrations: i64,
    enemies_damaged: i64,
    survival_sum: f64,
    survival_known_battles: i64,
    vehicles: HashMap<String, i64>,
}

impl Accumulator {
    fn new(account_id: String) -> Self {
        Self {
            account_id,
            last_time: -1,
            nickname: String::new(),
            clan: String::new(),
            team: 0,
            battles: 0,
            wins: 0,
            survived: 0,
            kills: 0,
            damage: 0,
            assisted: 0,
            received: 0,
            blocked: 0,
            earned: 0,
            shots: 0,
            hits: 0,
            penetrations: 0,
            enemies_damaged: 0,
            survival_sum: 0.0,
            survival_known_battles: 0,
            vehicles: HashMap::new(),
        }
    }

    fn finish(self) -> Aggregate {
        let mut vehicle_usage: Vec<VehicleUsage> = self
            .vehicles
            .into_iter()
            .map(|(vehicle_id, battles)| VehicleUsage {
                vehicle_id,
                battles,
            })
            .collect();
        vehicle_usage.sort_by(|a, b| {
            b.battles
                .cmp(&a.battles)
                .then_with(|| a.vehicle_id.cmp(&b.vehicle_id))
        });
        Aggregate {
            account_id: self.account_id,
            nickname: self.nickname,
            clan: self.clan,
            team: self.team,
            battles: self.battles,
            wins: self.wins,
            survived: self.survived,
            kills: self.kills,
            damage: self.damage,
            assisted: self.assisted,
            received: self.received,
            blocked: self.blocked,
            earned: self.earned,
            shots: self.shots,
            hits: self.hits,
            penetrations: self.penetrations,
            enemies_damaged: self.enemies_damaged,
            survival_sum: self.survival_sum,
            survival_known_battles: self.survival_known_battles,
            vehicle_usage,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::result::ParticipantResult;

    fn participant(account: &str, team: i64, survived: bool, life: i64) -> ParticipantResult {
        ParticipantResult {
            participant_ref: account.to_string(),
            game_account_id: account.to_string(),
            nickname: Some(format!("N{account}")),
            clan: None,
            team: Some(team),
            vehicle_id: Some("4481".to_string()),
            damage_dealt: Some(1000),
            damage_assisted: Some(100),
            damage_received: Some(500),
            damage_blocked: Some(200),
            kills: Some(1),
            shots: Some(10),
            hits_dealt: Some(5),
            penetrations_dealt: Some(3),
            hits_received: Some(2),
            penetrations_received: Some(1),
            enemies_damaged: Some(2),
            survived,
            settlement_life_time_sec: Some(life),
            death_reason_raw: None,
            killer_account_id: None,
            victory_points_earned: Some(50),
            victory_points_seized: None,
        }
    }

    fn battle(
        winner: i64,
        duration: Option<f64>,
        battle_time: Option<i64>,
        players: Vec<ParticipantResult>,
    ) -> BattleResult {
        BattleResult {
            arena_id: "1".to_string(),
            game_version: None,
            battle_time,
            duration_sec: duration,
            settlement_duration_sec: duration,
            settlement_finish_reason_raw: None,
            battle_mode: None,
            map: None,
            recorder_vehicle: None,
            winner_team: Some(winner),
            roster_len: players.len(),
            roster_complete: true,
            participants: players,
            quality: crate::meta::ParseQuality::default(),
        }
    }

    #[test]
    fn accumulates_and_keeps_the_latest_identity() {
        let first = battle(
            1,
            Some(300.0),
            Some(1_000),
            vec![
                participant("7", 1, true, 300),
                participant("8", 2, false, 100),
            ],
        );
        let mut renamed = participant("7", 2, false, 50);
        renamed.nickname = Some("RENAMED".to_string());
        renamed.vehicle_id = Some("9001".to_string());
        // Second battle: account 7 is on team 2 while team 1 wins, so it counts as a loss.
        let second = battle(1, Some(200.0), Some(2_000), vec![renamed]);

        let aggregates = aggregate(&[first, second]);
        assert_eq!(aggregates.len(), 2);
        let seven = &aggregates[0];
        assert_eq!(seven.account_id, "7");
        assert_eq!(seven.nickname, "RENAMED");
        assert_eq!(seven.team, 2, "latest battle owns the team");
        assert_eq!(seven.battles, 2);
        assert_eq!(seven.wins, 1, "won once, lost once");
        assert_eq!(seven.survived, 1);
        assert_eq!(
            seven.survival_sum, 350.0,
            "300 (winner duration) + 50 (death second)"
        );
        assert_eq!(seven.survival_known_battles, 2);
        assert_eq!(seven.survival_time_avg(), Some(175.0));
        assert_eq!(seven.damage, 2000);
        assert_eq!(seven.hit_rate(), Some(50.0));
        assert_eq!(seven.penetration_rate(), Some(60.0));
        assert_eq!(
            seven.vehicle_usage,
            vec![
                VehicleUsage {
                    vehicle_id: "4481".to_string(),
                    battles: 1
                },
                VehicleUsage {
                    vehicle_id: "9001".to_string(),
                    battles: 1
                },
            ]
        );
    }

    #[test]
    fn survival_average_is_unavailable_when_a_battle_lacks_a_second() {
        // A survivor in a battle with no duration cannot prove a survival time.
        let unknown = battle(1, None, Some(1_000), vec![participant("7", 1, true, 0)]);
        let known = battle(
            1,
            Some(120.0),
            Some(2_000),
            vec![participant("7", 1, true, 120)],
        );
        let aggregates = aggregate(&[unknown, known]);
        assert_eq!(aggregates[0].battles, 2);
        assert_eq!(aggregates[0].survival_known_battles, 1);
        assert_eq!(aggregates[0].survival_time_avg(), None);
    }

    #[test]
    fn rates_are_unavailable_instead_of_fake_zero() {
        let mut silent = participant("7", 1, false, 10);
        silent.shots = Some(0);
        silent.hits_dealt = Some(0);
        silent.penetrations_dealt = Some(0);
        let aggregates = aggregate(&[battle(1, Some(100.0), Some(1), vec![silent])]);
        assert_eq!(aggregates[0].hit_rate(), None);
        assert_eq!(aggregates[0].penetration_rate(), None);
        assert_eq!(aggregates[0].win_rate(), 100.0);
    }
}
