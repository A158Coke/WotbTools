//! M6 WP6.1 parity gate: the Rust packet-stream framing must match the Java oracle byte for byte.
//!
//! The golden (`tests/golden/packet-stream.json`, produced by
//! `tests/java-golden/PacketStreamGoldenDumper.java`) carries, for every committed fixture:
//!
//! * the parsed header (magic / unknown bytes / hash / version / packet-stream offset),
//! * a whole-stream FNV-1a digest over `[12 frame-header bytes][payload bytes]` for **every** packet
//!   in frame order — so count, order, framing, clocks, lengths and payloads are all covered,
//! * per-1000-packet block digests so a mismatch localizes instead of just failing,
//! * per-type statistics and a bounded plaintext sample of individual packets.
//!
//! Digests and clock *bit patterns* (never formatted floats) are compared, so this cannot pass or
//! fail on a formatting difference.

use std::collections::BTreeMap;
use std::path::PathBuf;

use replay_core::container::ReplayArchive;
use replay_core::stream::{PacketStream, FRAME_HEADER_LEN};
use serde::Deserialize;

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;
const SAMPLE_HEAD: usize = 64;
const SAMPLE_TAIL: usize = 16;
const SAMPLE_STRIDE: usize = 5000;
const BLOCK_SIZE: usize = 1000;

fn fnv(hash: u64, byte: u8) -> u64 {
    (hash ^ byte as u64).wrapping_mul(FNV_PRIME)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Golden {
    fixtures: Vec<GoldenFixture>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenFixture {
    name: String,
    source_size: usize,
    header: GoldenHeader,
    packet_count: usize,
    stream_digest: String,
    block_digests: Vec<String>,
    first_clock_bits: u64,
    max_clock_bits: u64,
    clock_regression_count: u32,
    type_stats: Vec<GoldenTypeStats>,
    sample_packets: Vec<GoldenSample>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenHeader {
    magic: String,
    unknown_header_bytes_hex: String,
    client_hash: String,
    client_version: String,
    packet_stream_offset: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenTypeStats {
    #[serde(rename = "type")]
    packet_type: u64,
    count: u32,
    first_clock_bits: u64,
    max_clock_bits: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenSample {
    sequence: u32,
    source_offset: usize,
    #[serde(rename = "type")]
    packet_type: u64,
    clock_bits: u64,
    payload_len: u32,
    payload_digest: String,
}

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .expect("workspace root")
}

fn hex64(value: u64) -> String {
    format!("{value:016x}")
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn is_sample(sequence: usize, count: usize) -> bool {
    sequence < SAMPLE_HEAD
        || sequence >= count.saturating_sub(SAMPLE_TAIL)
        || sequence.is_multiple_of(SAMPLE_STRIDE)
}

#[test]
fn packet_stream_matches_the_java_golden() {
    let root = workspace_root();
    let golden_text =
        std::fs::read_to_string(root.join("replay-engine/tests/golden/packet-stream.json"))
            .expect("packet-stream golden");
    let golden: Golden = serde_json::from_str(&golden_text).expect("golden json");
    assert!(!golden.fixtures.is_empty(), "golden must cover fixtures");

    for expected in &golden.fixtures {
        let label = &expected.name;
        let archive_bytes = std::fs::read(root.join("common/fixtures/replays").join(label))
            .unwrap_or_else(|e| panic!("{label}: {e}"));
        let archive =
            ReplayArchive::open(&archive_bytes).unwrap_or_else(|e| panic!("{label}: {e}"));
        let stream_bytes = archive
            .read_stream()
            .unwrap_or_else(|e| panic!("{label}: {e}"));
        let parsed = PacketStream::open(&stream_bytes).unwrap_or_else(|e| panic!("{label}: {e}"));

        assert_eq!(
            parsed.diagnostics.source_size, expected.source_size,
            "{label}"
        );
        assert_eq!(
            parsed.header.magic.to_string(),
            expected.header.magic,
            "{label}: magic"
        );
        assert_eq!(
            hex(&parsed.header.unknown_header_bytes),
            expected.header.unknown_header_bytes_hex,
            "{label}: unknown header bytes"
        );
        assert_eq!(
            parsed.header.client_hash, expected.header.client_hash,
            "{label}: hash"
        );
        assert_eq!(
            parsed.header.client_version, expected.header.client_version,
            "{label}: version"
        );
        assert_eq!(
            parsed.header.packet_stream_offset, expected.header.packet_stream_offset,
            "{label}: packet stream offset"
        );

        assert_eq!(
            parsed.packets.len(),
            expected.packet_count,
            "{label}: packet count"
        );
        assert_eq!(
            parsed.diagnostics.packet_count, expected.packet_count,
            "{label}: diagnostics packet count"
        );
        assert_eq!(
            parsed.diagnostics.first_clock_sec.to_bits() as u64,
            expected.first_clock_bits,
            "{label}: first clock bits"
        );
        assert_eq!(
            parsed.diagnostics.max_observed_raw_clock_sec.to_bits() as u64,
            expected.max_clock_bits,
            "{label}: max clock bits"
        );
        assert_eq!(
            parsed.diagnostics.clock_regression_count, expected.clock_regression_count,
            "{label}: clock regression count"
        );

        // Whole-stream digest: covers every packet's framing bytes and payload in order.
        let mut stream_digest = FNV_OFFSET;
        let mut block_digests: Vec<String> = Vec::new();
        let mut block_digest = FNV_OFFSET;
        let mut block_count = 0usize;
        let mut samples: Vec<(u32, usize, u64, u64, u32, String)> = Vec::new();
        for packet in &parsed.packets {
            for byte in &stream_bytes[packet.source_offset..packet.source_offset + FRAME_HEADER_LEN]
            {
                stream_digest = fnv(stream_digest, *byte);
                block_digest = fnv(block_digest, *byte);
            }
            for byte in packet.payload(&stream_bytes) {
                stream_digest = fnv(stream_digest, *byte);
                block_digest = fnv(block_digest, *byte);
            }
            block_count += 1;
            if block_count == BLOCK_SIZE {
                block_digests.push(hex64(block_digest));
                block_digest = FNV_OFFSET;
                block_count = 0;
            }
            if is_sample(packet.sequence as usize, parsed.packets.len()) {
                let mut payload_digest = FNV_OFFSET;
                for byte in packet.payload(&stream_bytes) {
                    payload_digest = fnv(payload_digest, *byte);
                }
                samples.push((
                    packet.sequence,
                    packet.source_offset,
                    packet.packet_type as u64,
                    packet.raw_clock_sec.to_bits() as u64,
                    packet.payload_len,
                    hex64(payload_digest),
                ));
            }
        }
        if block_count > 0 {
            block_digests.push(hex64(block_digest));
        }
        assert_eq!(
            hex64(stream_digest),
            expected.stream_digest,
            "{label}: whole-stream digest differs from the Java oracle"
        );
        assert_eq!(
            block_digests, expected.block_digests,
            "{label}: block digests"
        );

        // Per-type statistics, ordered by packet type exactly like the golden.
        let mut rust_types: BTreeMap<u64, (u32, u64, u64)> = BTreeMap::new();
        for (packet_type, stats) in &parsed.diagnostics.types {
            rust_types.insert(
                *packet_type as u64,
                (
                    stats.count,
                    stats.first_clock_sec.to_bits() as u64,
                    stats.max_observed_raw_clock_sec.to_bits() as u64,
                ),
            );
        }
        let expected_types: BTreeMap<u64, (u32, u64, u64)> = expected
            .type_stats
            .iter()
            .map(|t| {
                (
                    t.packet_type,
                    (t.count, t.first_clock_bits, t.max_clock_bits),
                )
            })
            .collect();
        assert_eq!(rust_types, expected_types, "{label}: per-type statistics");

        // Plaintext sample: individual packets stay readable in the golden.
        let rust_samples: Vec<(u32, usize, u64, u64, u32, String)> = samples;
        let expected_samples: Vec<(u32, usize, u64, u64, u32, String)> = expected
            .sample_packets
            .iter()
            .map(|s| {
                (
                    s.sequence,
                    s.source_offset,
                    s.packet_type,
                    s.clock_bits,
                    s.payload_len,
                    s.payload_digest.clone(),
                )
            })
            .collect();
        assert_eq!(rust_samples, expected_samples, "{label}: sampled packets");
    }
}
