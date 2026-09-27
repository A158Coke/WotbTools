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

#[test]
fn random_battle_fixture_is_a_full_roster() {
    let result = parse_result(&fixture_bytes("random-battle-example.wotbreplay")).expect("parses");
    assert_eq!(result.participants.len(), 14, "11.19 corpus is 7v7");
    assert_eq!(
        result.game_version.as_deref().map(str::is_empty),
        Some(false)
    );
    assert!(result.duration_sec.unwrap_or(0.0) > 0.0);
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
