//! League batch admission: team auto-naming and replay-mode classification.
//!
//! Ports `com.wotb.core.rating.LeagueTeamNamer` and `LeagueRatingMode`. Both answer the same
//! question — "does this batch become a League Rating batch, and what is the team called" — so they
//! live together instead of in two one-function files.
//!
//! The auto name never guesses: a tag must reach 4/7 to be adopted, and a name only ever lives in
//! the current session (no database, no localStorage, no server file).

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Majority clan-tag threshold: at least 4 of 7 players.
pub const MAJORITY_THRESHOLD: usize = 4;

/// Stable English code for "named by clan majority".
pub const NAME_SOURCE_CLAN_MAJORITY: &str = "CLAN_MAJORITY";
/// Stable English code for "still unnamed, the uploader may fill it in".
pub const NAME_SOURCE_UNNAMED: &str = "UNNAMED";

/// Training-room `arenaBonusType` (real fixture evidence).
pub const ARENA_BONUS_TYPE_TRAINING: i64 = 2;
/// Tournament/league `arenaBonusType` (real sample evidence).
pub const ARENA_BONUS_TYPE_TOURNAMENT: i64 = 4;

/// Auto name from the team's clan tags; `None` means "unnamed" (the uploader fills it in).
pub fn team_auto_name<'a>(clans: impl IntoIterator<Item = Option<&'a str>>) -> Option<String> {
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for clan in clans.into_iter().flatten() {
        // `hasText` semantics: blank tags never count, but the counted key stays verbatim.
        if clan.trim().is_empty() {
            continue;
        }
        *counts.entry(clan).or_insert(0) += 1;
    }
    let mut majority: Option<&str> = None;
    for (clan, count) in counts {
        if count >= MAJORITY_THRESHOLD {
            if let Some(existing) = majority {
                if existing != clan {
                    // Two tags above the threshold cannot happen in a 7-player team; stay defensive.
                    return None;
                }
            }
            majority = Some(clan);
        }
    }
    majority.map(str::to_string)
}

/// Name-source code matching [`team_auto_name`].
pub fn team_name_source<'a>(clans: impl IntoIterator<Item = Option<&'a str>>) -> &'static str {
    if team_auto_name(clans).is_some() {
        NAME_SOURCE_CLAN_MAJORITY
    } else {
        NAME_SOURCE_UNNAMED
    }
}

/// Whether an `arenaBonusType` is inside League Rating scope.
pub fn is_league(arena_bonus_type: Option<i64>) -> bool {
    matches!(
        arena_bonus_type,
        Some(ARENA_BONUS_TYPE_TRAINING) | Some(ARENA_BONUS_TYPE_TOURNAMENT)
    )
}

/// Batch mode over the successfully parsed replays.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum LeagueRatingMode {
    /// Ordinary replays only: keep the existing replay contract.
    StandardReplay,
    /// Training/tournament only: validate strictly and compute League Rating.
    LeagueRating,
    /// Both kinds in one batch: League Rating does not aggregate; parsing still succeeds.
    MixedUnsupported,
}

impl LeagueRatingMode {
    pub fn code(self) -> &'static str {
        match self {
            LeagueRatingMode::StandardReplay => "STANDARD_REPLAY",
            LeagueRatingMode::LeagueRating => "LEAGUE_RATING",
            LeagueRatingMode::MixedUnsupported => "MIXED_UNSUPPORTED",
        }
    }
}

/// Classifies a batch from the `arenaBonusType` of its successfully parsed replays.
///
/// Failed parses are reported as failures and never influence the mode.
pub fn classify(arena_bonus_types: &[Option<i64>]) -> LeagueRatingMode {
    if arena_bonus_types.is_empty() {
        return LeagueRatingMode::StandardReplay;
    }
    let mut has_league = false;
    let mut has_standard = false;
    for arena_bonus_type in arena_bonus_types {
        if is_league(*arena_bonus_type) {
            has_league = true;
        } else {
            has_standard = true;
        }
    }
    if has_league && has_standard {
        return LeagueRatingMode::MixedUnsupported;
    }
    if has_league {
        LeagueRatingMode::LeagueRating
    } else {
        LeagueRatingMode::StandardReplay
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auto_name_requires_a_clan_majority() {
        let four = ["AAA", "AAA", "AAA", "AAA", "BBB", "CCC", ""];
        assert_eq!(team_auto_name(four.map(Some)), Some("AAA".to_string()));
        let three = ["AAA", "AAA", "AAA", "BBB", "BBB", "CCC", "DDD"];
        assert_eq!(team_auto_name(three.map(Some)), None);
        // Blank tags are ignored entirely.
        let blanks: [Option<&str>; 3] = [Some("  "), None, Some("")];
        assert_eq!(team_auto_name(blanks), None);
        // A blank majority still cannot name the team.
        assert_eq!(team_name_source(four.map(Some)), NAME_SOURCE_CLAN_MAJORITY);
        assert_eq!(team_name_source(three.map(Some)), NAME_SOURCE_UNNAMED);
    }

    #[test]
    fn auto_name_is_defensive_when_two_tags_pass_the_threshold() {
        let nine = [
            "AAA", "AAA", "AAA", "AAA", "BBB", "BBB", "BBB", "BBB", "CCC",
        ];
        assert_eq!(team_auto_name(nine.map(Some)), None);
    }

    #[test]
    fn league_scope_is_training_and_tournament_only() {
        assert!(is_league(Some(ARENA_BONUS_TYPE_TRAINING)));
        assert!(is_league(Some(ARENA_BONUS_TYPE_TOURNAMENT)));
        for ordinary in [Some(1), Some(7), Some(8), Some(0), None] {
            assert!(!is_league(ordinary), "{ordinary:?} is an ordinary replay");
        }
    }

    #[test]
    fn batch_mode_classification() {
        assert_eq!(classify(&[]), LeagueRatingMode::StandardReplay);
        assert_eq!(
            classify(&[Some(2), Some(4)]),
            LeagueRatingMode::LeagueRating
        );
        assert_eq!(
            classify(&[Some(1), Some(7)]),
            LeagueRatingMode::StandardReplay
        );
        assert_eq!(
            classify(&[Some(2), Some(1)]),
            LeagueRatingMode::MixedUnsupported
        );
        assert_eq!(
            LeagueRatingMode::MixedUnsupported.code(),
            "MIXED_UNSUPPORTED"
        );
        assert_eq!(LeagueRatingMode::StandardReplay.code(), "STANDARD_REPLAY");
        assert_eq!(LeagueRatingMode::LeagueRating.code(), "LEAGUE_RATING");
    }
}
