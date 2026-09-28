//! Java oracle parity for every Type31/39 packet in all three committed fixtures.

use aim_marker::AimMarkerEvent;
use replay_core::container::ReplayArchive;
use replay_core::decoder::aim_marker;
use replay_core::decoder::{DecodeContext, DecodeEvent, DecodeStatus, DecoderRegistry};
use replay_core::stream::{Packet, PacketStream};
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Golden {
    decoders: Vec<String>,
    fixtures: Vec<Fixture>,
    synthetic: Vec<Synthetic>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    name: String,
    packet_count: usize,
    rows: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Synthetic {
    r#type: u32,
    hex: String,
    status: String,
    reason: String,
    warning_code: String,
    warning_message: String,
}

#[test]
fn java_aim_marker_subset_matches() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let golden: Golden = serde_json::from_slice(
        &std::fs::read(root.join("replay-engine/tests/golden/decode-aim-marker.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        golden.decoders,
        ["GunMarkerSizeDecoder", "AimRayStateDecoder"]
    );
    assert_eq!(golden.fixtures.len(), 3);
    assert_eq!(
        DecoderRegistry::aim_marker_subset().decoder_names(),
        golden
            .decoders
            .iter()
            .map(String::as_str)
            .collect::<Vec<_>>()
    );
    for fixture in golden.fixtures {
        let bytes =
            std::fs::read(root.join("common/fixtures/replays").join(&fixture.name)).unwrap();
        let stream = ReplayArchive::open(&bytes).unwrap().read_stream().unwrap();
        let packets = PacketStream::open(&stream).unwrap().packets;
        assert_eq!(packets.len(), fixture.packet_count);
        let registry = DecoderRegistry::aim_marker_subset();
        let mut context = DecodeContext::default();
        let rows: Vec<String> = packets
            .iter()
            .filter(|p| matches!(p.packet_type, 31 | 39))
            .map(|p| {
                let result = registry.decode(&mut context, p, &stream);
                match &result.events[0] {
                    DecodeEvent::AimMarker(AimMarkerEvent::GunMarkerSize { bits }) => {
                        assert_eq!(result.status, DecodeStatus::Success);
                        format!("{}|31|SUCCESS|{bits}", p.sequence)
                    }
                    DecodeEvent::AimMarker(AimMarkerEvent::AimRayState { bits }) => format!(
                        "{}|39|SUCCESS|{}",
                        p.sequence,
                        bits.map(|b| b.to_string()).join("|")
                    ),
                    DecodeEvent::AimMarker(AimMarkerEvent::Unknown { reason }) => {
                        format!("{}|{}|MALFORMED|{reason}", p.sequence, p.packet_type)
                    }
                    other => panic!("unexpected event {other:?}"),
                }
            })
            .collect();
        assert_eq!(rows, fixture.rows, "{}", fixture.name);
    }
    for sample in golden.synthetic {
        let bytes: Vec<u8> = sample
            .hex
            .as_bytes()
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
            .collect();
        let packet = Packet {
            sequence: 0,
            source_offset: 0,
            payload_len: bytes.len() as u32,
            packet_type: sample.r#type,
            raw_clock_sec: 0.0,
            payload_offset: 0,
        };
        let result = DecoderRegistry::aim_marker_subset().decode(
            &mut DecodeContext::default(),
            &packet,
            &bytes,
        );
        assert_eq!(sample.status, "MALFORMED");
        assert_eq!(result.status, DecodeStatus::Malformed);
        assert!(
            matches!(&result.events[0], DecodeEvent::AimMarker(AimMarkerEvent::Unknown { reason }) if *reason == sample.reason)
        );
        assert_eq!(result.warnings[0].code, sample.warning_code);
        assert_eq!(result.warnings[0].message, sample.warning_message);
    }
}
