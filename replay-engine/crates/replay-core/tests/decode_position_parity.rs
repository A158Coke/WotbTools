//! All-packet parity with a Java registry containing only `PositionDecoder`.

use replay_core::container::ReplayArchive;
use replay_core::decoder::position::{self, decode_position, PositionEvent, PositionStatus};
use replay_core::decoder::{DecodeContext, DecodeEvent, DecodeStatus, DecoderRegistry};
use replay_core::stream::{Packet, PacketStream};
use serde::Deserialize;
use std::path::PathBuf;

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

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
    world: usize,
    attached: usize,
    unsupported: usize,
    partial: usize,
    digest: String,
    block_digests: Vec<String>,
    samples: Vec<String>,
}

fn status_name(status: DecodeStatus) -> &'static str {
    match status {
        DecodeStatus::Success => "SUCCESS",
        DecodeStatus::Partial => "PARTIAL",
        DecodeStatus::Malformed => "MALFORMED",
        DecodeStatus::Unsupported => "UNSUPPORTED",
        DecodeStatus::FormatMismatch => "FORMAT_MISMATCH",
    }
}

fn transform_fields(transform: &position::Transform) -> String {
    format!(
        "{}:{}:{}:{}:{}",
        transform.entity_id,
        transform.space_id,
        transform.attachment_parent_entity_id,
        transform
            .float_bits
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(":"),
        transform.trailing_state_raw
    )
}

#[test]
fn type10_layout_and_float_bits() {
    let mut source = vec![0u8; 53];
    source[4..8].copy_from_slice(&(-123i32).to_le_bytes());
    source[8..12].copy_from_slice(&56i32.to_le_bytes());
    source[12..16].copy_from_slice(&12i32.to_le_bytes());
    source[16..20].copy_from_slice(&(-0.0f32).to_bits().to_le_bytes());
    source[20..24].copy_from_slice(&f32::NAN.to_bits().to_le_bytes());
    source[52] = 255;
    let packet = Packet {
        sequence: 7,
        source_offset: 0,
        payload_len: 49,
        packet_type: 10,
        raw_clock_sec: 1.25,
        payload_offset: 4,
    };
    let result = decode_position(&packet, &source);
    assert_eq!(result.status, PositionStatus::Partial);
    assert_eq!(result.warnings[0].code, "TYPE10_NON_FINITE");
    let PositionEvent::Attached(transform) = result.event else {
        panic!("must remain local")
    };
    assert_eq!(transform.entity_id, -123);
    assert_eq!(transform.float_bits[0], (-0.0f32).to_bits());
    assert_eq!(transform.float_bits[1], f32::NAN.to_bits());
    assert_eq!(transform.trailing_state_raw, 255);
    for len in [0, 44, 45, 48, 50] {
        let malformed = decode_position(
            &Packet {
                payload_len: len,
                ..packet.clone()
            },
            &source,
        );
        assert_eq!(malformed.status, PositionStatus::Malformed);
        assert!(matches!(
            malformed.event,
            PositionEvent::Unknown {
                reason: "TYPE10_LAYOUT_MISMATCH",
                ..
            }
        ));
        assert_eq!(
            malformed.warnings[0].message,
            format!("Type10 expected 49 bytes, got {len}")
        );
    }
    let truncated = decode_position(&packet, &source[..52]);
    assert_eq!(truncated.status, PositionStatus::Malformed);
}

#[test]
fn java_position_only_registry_matches_every_fixture_packet() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let golden: Golden = serde_json::from_slice(
        &std::fs::read(root.join("replay-engine/tests/golden/decode-position.json"))
            .expect("golden"),
    )
    .expect("valid golden");
    assert_eq!(golden.decoders, ["PositionDecoder"]);
    assert_eq!(golden.fixtures.len(), 3);
    assert_eq!(
        DecoderRegistry::position_subset().decoder_names(),
        ["PositionDecoder"]
    );
    for expected in golden.fixtures {
        let archive = std::fs::read(root.join("common/fixtures/replays").join(&expected.name))
            .expect("fixture");
        let source = ReplayArchive::open(&archive)
            .expect("archive")
            .read_stream()
            .expect("stream");
        let packets = PacketStream::open(&source).expect("frames").packets;
        let mut digest = FNV_OFFSET;
        let mut block_digest = FNV_OFFSET;
        let mut block_count = 0;
        let mut block_digests = Vec::new();
        let mut samples = Vec::new();
        let (mut world, mut attached, mut unsupported, mut partial) = (0, 0, 0, 0);
        let registry = DecoderRegistry::position_subset();
        let mut context = DecodeContext::default();
        for packet in &packets {
            let result = registry.decode(&mut context, packet, &source);
            let event = match &result.events[0] {
                DecodeEvent::Position(position_event) => match position_event {
                    PositionEvent::World(t) => {
                        world += 1;
                        format!("world:{}", transform_fields(t))
                    }
                    PositionEvent::Attached(t) => {
                        attached += 1;
                        format!("attached:{}", transform_fields(t))
                    }
                    PositionEvent::Unknown { reason, .. } => {
                        unsupported += 1;
                        format!("unknown:{reason}")
                    }
                },
                DecodeEvent::Unknown { reason, .. } => {
                    unsupported += 1;
                    format!("unknown:{reason}")
                }
                DecodeEvent::Property(_) => panic!("property decoder is not in this subset"),
                DecodeEvent::Materialization(_) => {
                    panic!("materialization decoder is not in this subset")
                }
                other => panic!("unexpected event: {other:?}"),
            };
            if result.status == DecodeStatus::Partial {
                partial += 1;
            }
            let codes = result.warnings.iter().map(|w| w.code).collect::<Vec<_>>();
            let row = format!(
                "{}|{}|{}|{}|{}|{}|[{}]\n",
                packet.sequence,
                packet.packet_type,
                packet.raw_clock_sec.to_bits(),
                packet.payload_len,
                status_name(result.status),
                event,
                codes.join(", ")
            );
            for byte in row.bytes() {
                digest = (digest ^ u64::from(byte)).wrapping_mul(FNV_PRIME);
                block_digest = (block_digest ^ u64::from(byte)).wrapping_mul(FNV_PRIME);
            }
            block_count += 1;
            if block_count == 1000 {
                block_digests.push(format!("{block_digest:x}"));
                block_digest = FNV_OFFSET;
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
            block_digests.push(format!("{block_digest:x}"));
        }
        assert_eq!(
            packets.len(),
            expected.packet_count,
            "{} count",
            expected.name
        );
        assert_eq!(world, expected.world, "{} world", expected.name);
        assert_eq!(attached, expected.attached, "{} attached", expected.name);
        assert_eq!(
            unsupported, expected.unsupported,
            "{} unsupported",
            expected.name
        );
        assert_eq!(partial, expected.partial, "{} partial", expected.name);
        assert_eq!(
            format!("{digest:x}"),
            expected.digest,
            "{} digest",
            expected.name
        );
        assert_eq!(
            block_digests, expected.block_digests,
            "{} blocks",
            expected.name
        );
        assert_eq!(samples, expected.samples, "{} samples", expected.name);
    }
}
