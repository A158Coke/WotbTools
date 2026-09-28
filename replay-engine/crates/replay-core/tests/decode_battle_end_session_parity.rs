//! Full-packet parity for the Type14/Type35-only registry against Java's matching subset.

use std::path::PathBuf;

use replay_core::container::ReplayArchive;
use replay_core::decoder::{decode_battle_end_session, DecodeEvent, DecodeStatus};
use replay_core::stream::{Packet, PacketStream};
use serde::Deserialize;

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

#[derive(Deserialize)]
struct Golden {
    decoders: Vec<String>,
    fixtures: Vec<Fixture>,
    #[serde(rename = "malformedType35")]
    malformed_type35: MalformedType35,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MalformedType35 {
    status: String,
    reason: String,
    warning_code: String,
    warning_message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    name: String,
    packet_count: usize,
    closed: usize,
    session: usize,
    unsupported: usize,
    digest: String,
}

#[test]
fn java_subset_matches_every_packet() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let golden: Golden = serde_json::from_slice(
        &std::fs::read(root.join("replay-engine/tests/golden/decode-battle-end-session.json"))
            .expect("golden"),
    )
    .expect("valid golden");
    assert_eq!(
        golden.decoders,
        ["BattleEndDecoder", "SessionDecisecondLowByteDecoder"]
    );
    assert_eq!(golden.fixtures.len(), 3);

    let malformed = decode_battle_end_session(
        &Packet {
            sequence: 7,
            source_offset: 0,
            payload_len: 0,
            packet_type: 35,
            raw_clock_sec: 1.25,
            payload_offset: 0,
        },
        &[],
    );
    assert_eq!(malformed.status, DecodeStatus::Unsupported);
    assert_eq!(golden.malformed_type35.status, "UNSUPPORTED");
    assert!(
        matches!(&malformed.events[0], DecodeEvent::Unknown { reason, .. } if *reason == golden.malformed_type35.reason)
    );
    assert_eq!(
        malformed.warnings[0].code,
        golden.malformed_type35.warning_code
    );
    assert_eq!(
        malformed.warnings[0].message,
        golden.malformed_type35.warning_message
    );

    for expected in golden.fixtures {
        let archive_bytes =
            std::fs::read(root.join("common/fixtures/replays").join(&expected.name))
                .expect("fixture");
        let stream = ReplayArchive::open(&archive_bytes)
            .expect("archive")
            .read_stream()
            .expect("stream entry");
        let packets = PacketStream::open(&stream).expect("framing").packets;
        let mut digest = FNV_OFFSET;
        let mut closed = 0;
        let mut session = 0;
        let mut unsupported = 0;
        for packet in &packets {
            let result = decode_battle_end_session(packet, &stream);
            let event = match &result.events[0] {
                DecodeEvent::StreamClosed { .. } => {
                    closed += 1;
                    "closed".to_owned()
                }
                DecodeEvent::SessionDecisecondLowByte { low8, .. } => {
                    session += 1;
                    format!("session:{low8}")
                }
                DecodeEvent::Unknown { reason, .. } => {
                    unsupported += 1;
                    format!("unknown:{reason}")
                }
            };
            let status = match result.status {
                DecodeStatus::Success => "SUCCESS",
                DecodeStatus::Partial => "PARTIAL",
                DecodeStatus::Unsupported => "UNSUPPORTED",
                DecodeStatus::FormatMismatch => "FORMAT_MISMATCH",
                DecodeStatus::Malformed => "MALFORMED",
            };
            let row = format!(
                "{}|{}|{}|{}|{}|{}\n",
                packet.sequence,
                packet.packet_type,
                packet.raw_clock_sec.to_bits(),
                packet.payload_len,
                status,
                event
            );
            for byte in row.bytes() {
                digest = (digest ^ u64::from(byte)).wrapping_mul(FNV_PRIME);
            }
        }
        assert_eq!(
            packets.len(),
            expected.packet_count,
            "{} count",
            expected.name
        );
        assert_eq!(closed, expected.closed, "{} closed", expected.name);
        assert_eq!(session, expected.session, "{} session", expected.name);
        assert_eq!(
            unsupported, expected.unsupported,
            "{} unsupported",
            expected.name
        );
        assert_eq!(
            format!("{digest:x}"),
            expected.digest,
            "{} digest",
            expected.name
        );
    }
}
