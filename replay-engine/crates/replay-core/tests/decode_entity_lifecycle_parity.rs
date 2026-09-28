//! Java subset parity for entity lifecycle packet types.
use entity_lifecycle::{LifecycleEvent, LifecycleStatus};
use replay_core::decoder::entity_lifecycle;
use replay_core::decoder::{DecodeContext, DecodeEvent, DecodeStatus, DecoderRegistry};
use replay_core::{
    container::ReplayArchive,
    stream::{Packet, PacketStream},
};
use serde::Deserialize;
use std::path::PathBuf;

const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const PRIME: u64 = 0x0000_0100_0000_01b3;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Golden {
    decoders: Vec<String>,
    fixtures: Vec<Fixture>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    name: String,
    packet_count: usize,
    created: usize,
    removed: usize,
    announced: usize,
    unknown: usize,
    malformed: usize,
    digest: String,
    block_digests: Vec<String>,
    samples: Vec<String>,
}

fn packet(kind: u32, len: usize) -> Packet {
    Packet {
        sequence: 7,
        source_offset: 0,
        payload_len: len as u32,
        packet_type: kind,
        raw_clock_sec: 1.25,
        payload_offset: 0,
    }
}

#[test]
fn exact_shapes_and_malformed_cases_match_java() {
    let created = entity_lifecycle::decode(&packet(0, 3), &[1, 2, 3]);
    assert_eq!(created.status, LifecycleStatus::Partial);
    assert_eq!(
        created.warnings[0].message,
        "Entity create packet type 0: init data format not yet decoded"
    );
    assert!(
        matches!(&created.events[0], LifecycleEvent::Created { entity_id: -1, unknown_init_data, .. } if unknown_init_data == &[1, 2, 3])
    );
    for kind in [1, 2] {
        assert!(matches!(
            entity_lifecycle::decode(&packet(kind, 0), &[]).events[0],
            LifecycleEvent::Created { .. }
        ));
    }
    for len in 0..4 {
        let result = entity_lifecycle::decode(&packet(4, len), &vec![0; len]);
        assert_eq!(result.status, LifecycleStatus::Malformed);
        assert!(result.events.is_empty());
        assert_eq!(
            result.warnings[0].message,
            format!("EntityLeave packet too short: {len}")
        );
        let result = entity_lifecycle::decode(&packet(33, len), &vec![0; len]);
        assert_eq!(result.status, LifecycleStatus::Malformed);
        assert!(result.events.is_empty());
        assert_eq!(
            result.warnings[0].message,
            format!("Type33 packet too short: {len}")
        );
    }
    let leave = entity_lifecycle::decode(&packet(4, 4), &(-7i32).to_le_bytes());
    assert!(matches!(
        leave.events[0],
        LifecycleEvent::Removed { entity_id: -7, .. }
    ));
    let mismatch = entity_lifecycle::decode(&packet(4, 5), &[0; 5]);
    assert_eq!(mismatch.status, LifecycleStatus::Partial);
    assert!(matches!(
        mismatch.events[0],
        LifecycleEvent::Unknown {
            reason: "TYPE4_SHAPE_MISMATCH",
            ..
        }
    ));
    let mut payload = [0; 12];
    payload[..4].copy_from_slice(&(-8i32).to_le_bytes());
    let announced = entity_lifecycle::decode(&packet(33, 12), &payload);
    assert!(matches!(
        announced.events[0],
        LifecycleEvent::Announced { entity_id: -8, .. }
    ));
    payload[11] = 1;
    let mismatch = entity_lifecycle::decode(&packet(33, 12), &payload);
    assert!(matches!(
        mismatch.events[0],
        LifecycleEvent::Unknown {
            reason: "TYPE33_ZERO_TAIL_NONZERO",
            ..
        }
    ));
    let mismatch = entity_lifecycle::decode(&packet(33, 13), &[0; 13]);
    assert!(matches!(
        mismatch.events[0],
        LifecycleEvent::Unknown {
            reason: "TYPE33_SHAPE_MISMATCH",
            ..
        }
    ));
}

#[test]
fn java_subset_matches_every_fixture_packet() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let golden: Golden = serde_json::from_slice(
        &std::fs::read(root.join("replay-engine/tests/golden/decode-entity-lifecycle.json"))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        golden.decoders,
        [
            "EntityLeaveDecoder",
            "EntityCreateDecoder",
            "MaterializationAnnouncedDecoder"
        ]
    );
    assert_eq!(golden.fixtures.len(), 3);
    assert_eq!(
        DecoderRegistry::entity_lifecycle_subset().decoder_names(),
        golden
            .decoders
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
    );
    for expected in golden.fixtures {
        let archive =
            std::fs::read(root.join("common/fixtures/replays").join(&expected.name)).unwrap();
        let source = ReplayArchive::open(&archive)
            .unwrap()
            .read_stream()
            .unwrap();
        let packets = PacketStream::open(&source).unwrap().packets;
        assert_eq!(packets.len(), expected.packet_count);
        let (mut created, mut removed, mut announced, mut unknown, mut malformed) = (0, 0, 0, 0, 0);
        let (mut digest, mut block_digest, mut block_count) = (OFFSET, OFFSET, 0);
        let (mut blocks, mut samples) = (Vec::new(), Vec::new());
        let registry = DecoderRegistry::entity_lifecycle_subset();
        let mut context = DecodeContext::default();
        for p in &packets {
            let result = registry.decode(&mut context, p, &source);
            let status = match result.status {
                DecodeStatus::Success => "SUCCESS",
                DecodeStatus::Partial => "PARTIAL",
                DecodeStatus::Malformed => "MALFORMED",
                DecodeStatus::Unsupported => "UNSUPPORTED",
                DecodeStatus::FormatMismatch => "FORMAT_MISMATCH",
            };
            let event = match result.events.first() {
                Some(DecodeEvent::Lifecycle(LifecycleEvent::Created {
                    entity_id,
                    unknown_init_data,
                    ..
                })) => {
                    created += 1;
                    format!("created:{entity_id}:{}", hex(unknown_init_data))
                }
                Some(DecodeEvent::Lifecycle(LifecycleEvent::Removed { entity_id, .. })) => {
                    removed += 1;
                    format!("removed:{entity_id}")
                }
                Some(DecodeEvent::Lifecycle(LifecycleEvent::Announced {
                    entity_id,
                    zero_tail,
                    ..
                })) => {
                    announced += 1;
                    format!("announced:{entity_id}:{}", hex(zero_tail))
                }
                Some(DecodeEvent::Lifecycle(LifecycleEvent::Unknown { reason, .. })) => {
                    unknown += 1;
                    format!("unknown:{reason}")
                }
                Some(DecodeEvent::Unknown {
                    reason: "UNSUPPORTED_TYPE",
                    ..
                }) => {
                    unknown += 1;
                    "unknown:UNSUPPORTED_TYPE".to_owned()
                }
                None => {
                    malformed += 1;
                    "none".to_owned()
                }
                other => panic!("unexpected event {other:?}"),
            };
            let codes = result.warnings.iter().map(|w| w.code).collect::<Vec<_>>();
            let row = format!(
                "{}|{}|{}|{}|{}|{}|[{}]\n",
                p.sequence,
                p.packet_type,
                p.raw_clock_sec.to_bits(),
                p.payload_len,
                status,
                event,
                codes.join(", ")
            );
            for b in row.bytes() {
                digest = (digest ^ u64::from(b)).wrapping_mul(PRIME);
                block_digest = (block_digest ^ u64::from(b)).wrapping_mul(PRIME);
            }
            block_count += 1;
            if block_count == 1000 {
                blocks.push(format!("{block_digest:x}"));
                block_digest = OFFSET;
                block_count = 0;
            }
            if p.sequence < 64
                || p.sequence as usize >= packets.len() - 16
                || p.sequence % 2000 == 0
            {
                samples.push(row.trim_end().to_owned());
            }
        }
        if block_count > 0 {
            blocks.push(format!("{block_digest:x}"));
        }
        assert_eq!(
            (created, removed, announced, unknown, malformed),
            (
                expected.created,
                expected.removed,
                expected.announced,
                expected.unknown,
                expected.malformed
            ),
            "{}",
            expected.name
        );
        assert_eq!(format!("{digest:x}"), expected.digest, "{}", expected.name);
        assert_eq!(blocks, expected.block_digests, "{}", expected.name);
        assert_eq!(samples, expected.samples, "{}", expected.name);
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}
