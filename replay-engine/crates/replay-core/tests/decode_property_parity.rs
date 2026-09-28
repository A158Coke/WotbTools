//! Whole-stream Java parity with only `EntityPropertyDecoder` registered.

use replay_core::container::ReplayArchive;
use replay_core::decoder::property::PropertyEvent;
use replay_core::decoder::{DecodeContext, DecodeEvent, DecodeStatus, DecoderRegistry};
use replay_core::stream::PacketStream;
use serde::Deserialize;
use std::path::PathBuf;

const OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const PRIME: u64 = 0x100_0000_01b3;

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
    health: usize,
    turret: usize,
    unknown: usize,
    partial: usize,
    digest: String,
    block_digests: Vec<String>,
    samples: Vec<String>,
}

fn status_name(status: DecodeStatus) -> &'static str {
    match status {
        DecodeStatus::Success => "SUCCESS",
        DecodeStatus::Partial => "PARTIAL",
        DecodeStatus::Unsupported => "UNSUPPORTED",
        DecodeStatus::FormatMismatch => "FORMAT_MISMATCH",
        DecodeStatus::Malformed => "MALFORMED",
    }
}

#[test]
fn java_property_only_registry_matches_every_fixture_packet() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let golden: Golden = serde_json::from_slice(
        &std::fs::read(root.join("replay-engine/tests/golden/decode-property.json"))
            .expect("golden"),
    )
    .expect("valid golden");
    assert_eq!(golden.decoders, ["EntityPropertyDecoder"]);
    assert_eq!(
        DecoderRegistry::property_subset().decoder_names(),
        ["EntityPropertyDecoder"]
    );
    for expected in golden.fixtures {
        let archive = std::fs::read(root.join("common/fixtures/replays").join(&expected.name))
            .expect("fixture");
        let source = ReplayArchive::open(&archive)
            .expect("archive")
            .read_stream()
            .expect("stream");
        let packets = PacketStream::open(&source).expect("frames").packets;
        let registry = DecoderRegistry::property_subset();
        let mut context = DecodeContext::default();
        let mut digest = OFFSET;
        let mut block_digest = OFFSET;
        let mut block_count = 0;
        let mut blocks = Vec::new();
        let mut samples = Vec::new();
        let (mut health, mut turret, mut unknown, mut partial) = (0, 0, 0, 0);
        for packet in &packets {
            let result = registry.decode(&mut context, packet, &source);
            let event = match result.events.first() {
                Some(DecodeEvent::Property(PropertyEvent::Health {
                    entity_id,
                    current_health,
                    alive,
                    raw_current_health,
                    raw_state,
                    exact,
                    ..
                })) => {
                    health += 1;
                    let hp = current_health.map_or("null".to_owned(), |v| v.to_string());
                    let alive = alive.map_or("null".to_owned(), |v| v.to_string());
                    let state = match raw_state {
                        replay_core::decoder::property::HpRawState::CurrentHp => "CURRENT_HP",
                        replay_core::decoder::property::HpRawState::HpZeroTerminal => {
                            "HP_ZERO_TERMINAL"
                        }
                        replay_core::decoder::property::HpRawState::DeathTerminalFffd => {
                            "DEATH_TERMINAL_FFFD"
                        }
                        replay_core::decoder::property::HpRawState::UnknownFfff => "UNKNOWN_FFFF",
                        replay_core::decoder::property::HpRawState::UnknownOther => "UNKNOWN_OTHER",
                    };
                    format!(
                        "health:{entity_id}:{hp}:{alive}:{raw_current_health}:{state}:{}",
                        if *exact { "EXACT" } else { "PARTIAL" }
                    )
                }
                Some(DecodeEvent::Property(PropertyEvent::TurretDirection {
                    entity_id,
                    relative_yaw_deg_bits,
                    ..
                })) => {
                    turret += 1;
                    format!("turret:{entity_id}:{relative_yaw_deg_bits}")
                }
                Some(DecodeEvent::Property(PropertyEvent::Unknown { reason, .. })) => {
                    unknown += 1;
                    format!("unknown:{reason}")
                }
                Some(DecodeEvent::Unknown { reason, .. }) => {
                    unknown += 1;
                    format!("unknown:{reason}")
                }
                None => "none".to_owned(),
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
                digest = (digest ^ u64::from(byte)).wrapping_mul(PRIME);
                block_digest = (block_digest ^ u64::from(byte)).wrapping_mul(PRIME);
            }
            block_count += 1;
            if block_count == 1000 {
                blocks.push(format!("{block_digest:x}"));
                block_digest = OFFSET;
                block_count = 0;
            }
            if packet.sequence < 64
                || packet.sequence as usize >= packets.len() - 16
                || packet.sequence % 2000 == 0
            {
                samples.push(row.trim_end().to_owned());
            }
        }
        if block_count > 0 {
            blocks.push(format!("{block_digest:x}"));
        }
        assert_eq!(
            packets.len(),
            expected.packet_count,
            "{} packets",
            expected.name
        );
        assert_eq!(health, expected.health, "{} health", expected.name);
        assert_eq!(turret, expected.turret, "{} turret", expected.name);
        assert_eq!(unknown, expected.unknown, "{} unknown", expected.name);
        assert_eq!(partial, expected.partial, "{} partial", expected.name);
        assert_eq!(
            format!("{digest:x}"),
            expected.digest,
            "{} digest",
            expected.name
        );
        assert_eq!(blocks, expected.block_digests, "{} blocks", expected.name);
        assert_eq!(samples, expected.samples, "{} samples", expected.name);
    }
}
