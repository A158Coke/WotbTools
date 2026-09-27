//! M6 WP6.1 gate: strict contiguous framing over the committed replay fixtures.
//!
//! The synthetic unit tests in `src/stream.rs` lock the contract on hand-built bytes; this test locks
//! the same contract against real `data.wotreplay` streams so a "passes on toy input, fails on a real
//! file" port cannot slip through. Byte-level equality with the Java reader is WP6.7 (packet-stream
//! golden); here the invariants are structural and must hold for every fixture.

use std::path::PathBuf;

use replay_core::container::ReplayArchive;
use replay_core::stream::{PacketStream, TERMINATOR_TYPE};

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
fn every_committed_fixture_frames_contiguously() {
    for name in FIXTURES {
        let archive_bytes = fixture_bytes(name);
        let archive = ReplayArchive::open(&archive_bytes).unwrap_or_else(|e| panic!("{name}: {e}"));
        let stream_bytes = archive
            .read_stream()
            .unwrap_or_else(|e| panic!("{name}: {e}"));

        let parsed = PacketStream::open(&stream_bytes).unwrap_or_else(|e| panic!("{name}: {e}"));

        assert!(
            parsed.header.packet_stream_offset > 0
                && parsed.header.packet_stream_offset < stream_bytes.len(),
            "{name}: header offset must be inside the stream"
        );
        assert!(
            !parsed.header.client_version.is_empty(),
            "{name}: client version must be readable"
        );
        assert!(
            parsed.packets.len() > 1,
            "{name}: expected a real packet stream, got {} packets",
            parsed.packets.len()
        );
        assert_eq!(
            parsed.diagnostics.packet_count,
            parsed.packets.len(),
            "{name}: diagnostics must agree with the packet list"
        );

        // Strict contiguous framing: the frames tile the stream exactly and the last one is the
        // terminator (nothing may follow it — `open` already proves that).
        let mut expected_offset = parsed.header.packet_stream_offset;
        for (index, packet) in parsed.packets.iter().enumerate() {
            assert_eq!(
                packet.sequence as usize, index,
                "{name}: sequence must be the frame index"
            );
            assert_eq!(
                packet.source_offset, expected_offset,
                "{name}: frame {index} is not contiguous"
            );
            assert_eq!(
                packet.payload(&stream_bytes).len(),
                packet.payload_len as usize,
                "{name}: frame {index} payload view must match its declared length"
            );
            expected_offset += 12 + packet.payload_len as usize;
        }
        assert_eq!(
            expected_offset,
            stream_bytes.len(),
            "{name}: frames must tile the whole stream"
        );
        assert_eq!(
            parsed.packets.last().expect("non-empty").packet_type,
            TERMINATOR_TYPE,
            "{name}: stream must end with the terminator"
        );

        // Diagnostics are coherent with the frames they describe. Note the real terminator carries
        // clock 0, so it never defines the maximum — and it always counts as a clock regression
        // (locked in `src/stream.rs::terminator_clock_participates_in_regression_counting`).
        let min_clock = parsed
            .packets
            .iter()
            .map(|p| p.raw_clock_sec)
            .fold(f32::INFINITY, f32::min);
        let max_clock = parsed
            .packets
            .iter()
            .map(|p| p.raw_clock_sec)
            .fold(f32::NEG_INFINITY, f32::max);
        assert_eq!(
            parsed.diagnostics.first_clock_sec, min_clock,
            "{name}: first clock must be the frame minimum"
        );
        assert_eq!(
            parsed.diagnostics.max_observed_raw_clock_sec, max_clock,
            "{name}: max clock must be the frame maximum"
        );
        assert!(
            parsed.diagnostics.clock_regression_count >= 1,
            "{name}: the terminator's zero clock is a regression the Java reader also counts"
        );
        assert!(
            parsed
                .diagnostics
                .types
                .values()
                .map(|s| s.count)
                .sum::<u32>()
                == parsed.diagnostics.packet_count as u32,
            "{name}: per-type counts must cover every packet"
        );
    }
}

/// The framing contract is "fail closed", and in WASM a panic is a trap that takes the whole UI
/// down — so corruption must always surface as `Err`, never as a panic and never as silently
/// reinterpreted bytes. This sweeps truncations around real frame boundaries and byte flips inside
/// real frame headers.
#[test]
fn corruption_is_fail_closed_and_never_panics() {
    let name = "random-battle-example.wotbreplay";
    let archive_bytes = fixture_bytes(name);
    let archive = ReplayArchive::open(&archive_bytes).expect("archive");
    let stream_bytes = archive.read_stream().expect("stream");
    let parsed = PacketStream::open(&stream_bytes).expect("baseline stream");
    let packets = parsed.packets.clone();

    // For a prefix, either it is rejected, or every accepted frame tiles it exactly. Acceptance is
    // legal when the prefix happens to end on a frame boundary (the contract does not require a
    // terminator, exactly like the Java reader).
    let check = |label: &str, bytes: &[u8]| match PacketStream::open(bytes) {
        Err(_) => {}
        Ok(prefix) => {
            let mut expected_offset = prefix.header.packet_stream_offset;
            for (index, packet) in prefix.packets.iter().enumerate() {
                assert_eq!(
                    packet.sequence as usize, index,
                    "{label}: accepted prefix must keep sequences dense"
                );
                assert_eq!(
                    packet.source_offset, expected_offset,
                    "{label}: accepted prefix frame {index} must be contiguous"
                );
                expected_offset += 12 + packet.payload_len as usize;
            }
            assert_eq!(
                expected_offset,
                bytes.len(),
                "{label}: an accepted prefix must tile exactly"
            );
        }
    };

    // Truncations: every byte offset inside the header of the first 120 frames, plus the last 6
    // frames and the exact frame boundaries. Prefixes of early frames are tiny, and only the last
    // few force a near-full scan, so the sweep stays cheap.
    let mut offsets: Vec<usize> = Vec::new();
    for packet in packets.iter().take(120) {
        let start = packet.source_offset;
        for delta in 0..12 {
            offsets.push(start + delta);
        }
        offsets.push(start + 12 + packet.payload_len as usize);
    }
    for packet in packets.iter().rev().take(6) {
        let start = packet.source_offset;
        for delta in 0..12 {
            offsets.push(start + delta);
        }
        offsets.push(start + 12 + packet.payload_len as usize);
    }
    offsets.push(stream_bytes.len() - 1);
    for offset in offsets {
        if offset == 0 || offset >= stream_bytes.len() {
            continue;
        }
        check(
            &format!("{name}: truncation at {offset}"),
            &stream_bytes[..offset],
        );
    }

    // Byte flips inside real frame headers: flip one field byte, then cut the stream right after
    // that frame, so each run only frames up to the corruption (constant work per sample) while
    // still exercising `payloadLen` / `type` / `clock` on real bytes.
    for packet in packets.iter().take(96).step_by(3) {
        let frame_end = packet.source_offset + 12 + packet.payload_len as usize;
        if frame_end > stream_bytes.len() {
            continue;
        }
        for delta in [0usize, 1, 4, 5, 8, 9] {
            let mut corrupted = stream_bytes[..frame_end].to_vec();
            let index = packet.source_offset + delta;
            corrupted[index] ^= 0xFF;
            check(&format!("{name}: flip at {index}"), &corrupted);
        }
    }
}
