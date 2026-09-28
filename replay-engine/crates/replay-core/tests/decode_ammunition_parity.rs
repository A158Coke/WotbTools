//! Full-packet parity for the Type28-only Java decoder registry.

use std::path::PathBuf;

use replay_core::container::ReplayArchive;
use replay_core::decoder::ammunition::AmmunitionEvent;
use replay_core::decoder::{DecodeContext, DecodeEvent, DecodeStatus, DecoderRegistry};
use replay_core::stream::PacketStream;
use serde::Deserialize;

const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const PRIME: u64 = 0x0000_0100_0000_01b3;

#[derive(Deserialize)]
struct Golden {
    decoders: Vec<String>,
    fixtures: Vec<Fixture>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    name: String,
    packet_count: usize,
    selected: usize,
    partial: usize,
    digest: String,
    blocks: Vec<String>,
    samples: Vec<String>,
}

#[test]
fn java_type28_subset_matches_every_packet() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let golden: Golden = serde_json::from_slice(
        &std::fs::read(root.join("replay-engine/tests/golden/decode-ammunition.json"))
            .expect("golden"),
    )
    .expect("valid golden");
    assert_eq!(golden.decoders, ["AmmunitionSelectionDecoder"]);
    assert_eq!(golden.fixtures.len(), 3);
    for expected in golden.fixtures {
        let archive = std::fs::read(root.join("common/fixtures/replays").join(&expected.name))
            .expect("fixture");
        let source = ReplayArchive::open(&archive)
            .expect("archive")
            .read_stream()
            .expect("stream");
        let packets = PacketStream::open(&source).expect("framing").packets;
        let registry = DecoderRegistry::ammunition_subset();
        let mut context = DecodeContext::default();
        let (mut selected, mut partial) = (0, 0);
        let (mut digest, mut block) = (OFFSET, OFFSET);
        let mut block_count = 0;
        let mut blocks = Vec::new();
        let mut samples = Vec::new();
        for packet in &packets {
            let result = registry.decode(&mut context, packet, &source);
            let event = match &result.events[0] {
                DecodeEvent::Ammunition(AmmunitionEvent::Selection { value, exact, .. }) => {
                    selected += 1;
                    if result.status == DecodeStatus::Partial {
                        partial += 1;
                    }
                    format!(
                        "selection:{value}:{}",
                        if *exact { "EXACT" } else { "PARTIAL" }
                    )
                }
                DecodeEvent::Ammunition(AmmunitionEvent::Unknown { .. }) => {
                    "unknown:TYPE28_LAYOUT_MISMATCH".to_owned()
                }
                DecodeEvent::Unknown { reason, .. } => format!("unknown:{reason}"),
                other => panic!("unexpected event {other:?}"),
            };
            let status = match result.status {
                DecodeStatus::Success => "SUCCESS",
                DecodeStatus::Partial => "PARTIAL",
                DecodeStatus::Unsupported => "UNSUPPORTED",
                DecodeStatus::FormatMismatch => "FORMAT_MISMATCH",
                DecodeStatus::Malformed => "MALFORMED",
            };
            let codes = result.warnings.iter().map(|w| w.code).collect::<Vec<_>>();
            let row = format!(
                "{}|{}|{}|{}|{}|{}|[{}]\n",
                packet.sequence,
                packet.packet_type,
                packet.raw_clock_sec.to_bits(),
                packet.payload_len,
                status,
                event,
                codes.join(", ")
            );
            for byte in row.bytes() {
                digest = (digest ^ u64::from(byte)).wrapping_mul(PRIME);
                block = (block ^ u64::from(byte)).wrapping_mul(PRIME);
            }
            block_count += 1;
            if block_count == 1000 {
                blocks.push(format!("{block:x}"));
                block = OFFSET;
                block_count = 0;
            }
            if packet.sequence < 64
                || usize::try_from(packet.sequence).expect("sequence") >= packets.len() - 16
                || packet.sequence % 2000 == 0
            {
                samples.push(row.trim_end().to_owned());
            }
        }
        if block_count > 0 {
            blocks.push(format!("{block:x}"));
        }
        assert_eq!(
            packets.len(),
            expected.packet_count,
            "{} packets",
            expected.name
        );
        assert_eq!(selected, expected.selected, "{} selected", expected.name);
        assert_eq!(partial, expected.partial, "{} partial", expected.name);
        assert_eq!(
            format!("{digest:x}"),
            expected.digest,
            "{} digest",
            expected.name
        );
        assert_eq!(blocks, expected.blocks, "{} blocks", expected.name);
        assert_eq!(samples, expected.samples, "{} samples", expected.name);
    }
}
