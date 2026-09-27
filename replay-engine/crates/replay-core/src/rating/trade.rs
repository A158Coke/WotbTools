//! Trade facts: the settlement-second trade window used by the survival/RC dimension.
//!
//! Ports `com.wotb.core.replay.facts.TradeFacts`: a dead player is "traded" when an **enemy** death
//! falls inside `[playerDeath, playerDeath + 5s]` (directional, boundaries inclusive). Both seconds
//! come from settlement `lifeTime` only; live reconstruction never participates.

use super::RatingPlayer;

/// Trade window after the player's own death, in seconds.
pub const TRADE_AFTER_DEATH_WINDOW_SEC: f64 = 5.0;

/// Business death second of a combatant (`0` when survived or when settlement seconds are unusable).
pub fn death_sec(player: &RatingPlayer) -> f64 {
    if player.survived {
        return 0.0;
    }
    match player.settlement_life_time_sec {
        Some(seconds) if seconds > 0 => seconds as f64,
        _ => 0.0,
    }
}

/// Number of enemy deaths inside the trade window (`>= 0`).
pub fn traded_deaths(player: &RatingPlayer, players: &[RatingPlayer]) -> i64 {
    if player.survived || players.is_empty() {
        return 0;
    }
    let player_death = death_sec(player);
    if player_death <= 0.0 {
        return 0;
    }
    let mut enemy_deaths = 0i64;
    for other in players {
        if other.team == player.team || other.survived {
            continue;
        }
        let enemy_death = death_sec(other);
        if enemy_death <= 0.0 {
            continue;
        }
        let delta = enemy_death - player_death;
        if (0.0..=TRADE_AFTER_DEATH_WINDOW_SEC).contains(&delta) {
            enemy_deaths += 1;
        }
    }
    enemy_deaths.max(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn player(team: i64, life: Option<i64>, survived: bool) -> RatingPlayer {
        RatingPlayer {
            team,
            settlement_life_time_sec: life,
            survived,
            ..RatingPlayer::default()
        }
    }

    #[test]
    fn trade_window_is_directional_and_boundary_inclusive() {
        let dead = player(1, Some(100), false);
        // Enemy dies 5s later -> inside (boundary inclusive).
        let traded = [dead.clone(), player(2, Some(105), false)];
        assert_eq!(traded_deaths(&dead, &traded), 1);
        // Enemy dies 6s later -> outside.
        let late = [dead.clone(), player(2, Some(106), false)];
        assert_eq!(traded_deaths(&dead, &late), 0);
        // Enemy died before the player -> not a trade.
        let earlier = [dead.clone(), player(2, Some(95), false)];
        assert_eq!(traded_deaths(&dead, &earlier), 0);
        // Same-team death is not a trade.
        let friendly = [dead.clone(), player(1, Some(101), false)];
        assert_eq!(traded_deaths(&dead, &friendly), 0);
        // Surviving enemies are not trades, and a survivor is never traded.
        let survivor = player(2, None, true);
        assert_eq!(traded_deaths(&dead, &[dead.clone(), survivor.clone()]), 0);
        assert_eq!(
            traded_deaths(&survivor, &[dead.clone(), survivor.clone()]),
            0
        );
    }

    #[test]
    fn trade_requires_a_usable_settlement_death_second() {
        let unknown_death = player(1, None, false);
        assert_eq!(
            traded_deaths(&unknown_death, &[player(2, Some(1), false)]),
            0
        );
    }
}
