//! Integration tests against the committed replay fixtures.
//!
//! Two invariants are locked here:
//! 1. every committed fixture parses into a canonical result with a stable arena id;
//! 2. `parseResult` does not depend on `data.wotreplay` — a corrupted packet stream must still
//!    produce a result (that separation is the whole point of the two entry points).

use std::io::Cursor;
use std::path::PathBuf;

use replay_core::container::{ReplayArchive, STREAM_ENTRY};
use replay_core::parse_result;

const FIXTURES: [&str; 3] = [
    "random-battle-example.wotbreplay",
    "cw-training-15-14-example.wotbreplay",
    "tournament-14-14-example.wotbreplay",
];

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("workspace root")
}

fn fixture_bytes(name: &str) -> Vec<u8> {
    let path = workspace_root().join("common/fixtures/replays").join(name);
    std::fs::read(&path).unwrap_or_else(|e| panic!("cannot read {}: {e}", path.display()))
}

#[test]
fn parses_every_committed_fixture() {
    for name in FIXTURES {
        let bytes = fixture_bytes(name);
        let result = parse_result(&bytes).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(
            result.arena_id.parse::<u64>().is_ok(),
            "{name}: arena id must be a decimal string, got {}",
            result.arena_id
        );
        assert!(!result.participants.is_empty(), "{name}: no participants");
        assert!(
            matches!(result.winner_team, Some(1) | Some(2)),
            "{name}: winner team must be 1 or 2, got {:?}",
            result.winner_team
        );
        assert!(
            result
                .participants
                .iter()
                .all(|p| !p.game_account_id.is_empty()),
            "{name}: account id must never be empty"
        );
        for participant in &result.participants {
            assert!(
                participant.survived || participant.settlement_life_time_sec.unwrap_or(0) > 0,
                "{name}: dead combatant without lifeTime"
            );
        }
    }
}

/// Result parity against the committed Java golden
/// (`java/wotb-core/src/test/java/com/wotb/core/ReplayParserFixtureTest.java:42-76`).
///
/// The expectations are the repository's own authoritative numbers, so a Rust regression in tag
/// mapping, team resolution or roster joins fails here instead of silently shipping.
#[test]
fn random_battle_fixture_matches_the_java_golden() {
    let result = parse_result(&fixture_bytes("random-battle-example.wotbreplay")).expect("parses");

    assert_eq!(result.arena_id, "1168689173149065733");
    assert_eq!(result.map.as_deref(), Some("rift"));
    assert_eq!(result.winner_team, Some(2));
    assert_eq!(result.participants.len(), 14);
    assert!(
        result.roster_complete,
        "real 7v7 fixture: #201 and #301 account sets agree"
    );

    let damage_dealt = |team: i64| -> i64 {
        result
            .participants
            .iter()
            .filter(|p| p.team == Some(team))
            .filter_map(|p| p.damage_dealt)
            .sum()
    };
    assert_eq!(damage_dealt(1), 12917, "team 1 damage dealt");
    assert_eq!(damage_dealt(2), 13600, "team 2 damage dealt");

    assert_eq!(
        result.participants.iter().filter(|p| p.survived).count(),
        1,
        "survivors"
    );
    assert!(
        result
            .participants
            .iter()
            .all(|p| p.nickname.as_deref().is_some_and(|name| !name.is_empty())),
        "every settled combatant resolves a non-empty roster nickname"
    );
    assert!(result.duration_sec.unwrap_or(0.0) > 0.0);

    // Battle timing parity (`ReplayParser.java:238-249`): settlement root5 decides the duration,
    // the clamp is 420s, and implausible epochs never surface as a battle time.
    assert!(
        result.duration_sec.unwrap_or(0.0) <= 420.0,
        "duration must be clamped to 420s"
    );
    if let Some(settlement) = result.settlement_duration_sec.filter(|value| *value > 0.0) {
        assert_eq!(
            result.duration_sec,
            Some(settlement.min(420.0)),
            "settlement root5 is the duration authority"
        );
    }
    if let Some(battle_time) = result.battle_time {
        assert!(
            battle_time > 1_388_534_400,
            "battle time must be a plausible epoch, got {battle_time}"
        );
    }
}

/// Structural parity against `ReplayParserFixtureTest.committedFixturesAreStructurallyValid`.
#[test]
fn committed_fixtures_satisfy_the_structural_invariants() {
    for name in FIXTURES {
        let result = parse_result(&fixture_bytes(name)).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert_eq!(result.participants.len(), 14, "{name}: settled combatants");

        let mut kills = [0i64; 3];
        let mut deaths = [0i64; 3];
        for participant in &result.participants {
            let shots = participant.shots.unwrap_or(0);
            let hits = participant.hits_dealt.unwrap_or(0);
            let penetrations = participant.penetrations_dealt.unwrap_or(0);
            assert!(
                shots >= hits && hits >= penetrations,
                "{name}: shots >= hits >= penetrations"
            );
            if let Some(team) = participant.team.filter(|t| (1..=2).contains(t)) {
                let index = team as usize;
                kills[index] += participant.kills.unwrap_or(0);
                if !participant.survived {
                    deaths[index] += 1;
                }
            }
        }
        assert_eq!(deaths[2], kills[1], "{name}: team1 kills == team2 deaths");
        assert_eq!(deaths[1], kills[2], "{name}: team2 kills == team1 deaths");

        // The roster of this fixture carries non-combatant extras, so the strict Java semantics
        // (`#201` set == `#301` set) must report incomplete rather than papering over it.
        if name.contains("cw-training-15-14") {
            assert!(
                !result.roster_complete,
                "{name}: roster has non-combatant extras -> roster_complete must stay false"
            );
        }
    }
}

#[test]
fn corrupted_stream_entry_does_not_break_parse_result() {
    let mut bytes = fixture_bytes("random-battle-example.wotbreplay");
    let (start, len) = {
        let mut zip =
            zip::ZipArchive::new(Cursor::new(bytes.as_slice())).expect("fixture is a zip");
        let file = zip.by_name(STREAM_ENTRY).expect("stream entry");
        (file.data_start() as usize, file.compressed_size() as usize)
    };
    assert!(len > 0, "fixture must contain a non-empty packet stream");
    for byte in &mut bytes[start..start + len] {
        *byte ^= 0xff;
    }

    // The corruption is real: reading the stream now fails.
    let archive = ReplayArchive::open(&bytes).expect("central directory is untouched");
    assert!(
        archive.read_stream().is_err(),
        "corruption must be detectable"
    );

    // ...and the settlement result is unaffected.
    let result = parse_result(&bytes).expect("parseResult must not touch data.wotreplay");
    assert!(!result.participants.is_empty());
}

#[test]
fn rejects_a_non_archive() {
    let error = parse_result(b"definitely not a replay").unwrap_err();
    assert_eq!(error.code(), "INVALID_ARCHIVE");
}
