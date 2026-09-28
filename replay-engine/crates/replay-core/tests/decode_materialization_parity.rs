//! Every Type5 packet in three committed replays, compared with the Java decoder oracle.

use replay_core::container::ReplayArchive;
use replay_core::decoder::materialization::{self, MaterializationEvent, VehicleBattleLoadout};
use replay_core::decoder::{
    DecodeContext, DecodeEvent, DecodeWarning, DecoderRegistry, EntityClass,
};
use replay_core::stream::PacketStream;
use serde::Deserialize;
use std::path::PathBuf;

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
    rows: Vec<String>,
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn loadout(value: &VehicleBattleLoadout) -> String {
    let mut result = if value.partial { "PARTIAL" } else { "EXACT" }.to_owned();
    for item in value.consumables.iter().chain(&value.provisions) {
        result.push_str(&format!(
            ";{}:{}:{}:{}:{}:{}",
            item.slot,
            item.wire_code,
            item.state_raw,
            hex(&item.payload_raw),
            item.logical_item_id.unwrap_or("null"),
            if item.logical_item_id.is_some() {
                "EXACT"
            } else {
                "PARTIAL"
            }
        ));
    }
    for equipment in value.equipment {
        result.push_str(&format!(";{equipment}"));
    }
    result
}

fn row(event: &MaterializationEvent, warnings: &[DecodeWarning], class: &str) -> String {
    let status = if warnings.is_empty() {
        "SUCCESS"
    } else {
        "PARTIAL"
    };
    let hp = event
        .current_hp
        .map_or_else(|| "null".to_owned(), |hp| hp.to_string());
    let loadout = event
        .loadout
        .as_ref()
        .map_or_else(|| "null".to_owned(), loadout);
    let warnings = warnings
        .iter()
        .map(|w| format!("{}:{}", w.code, w.message))
        .collect::<Vec<_>>()
        .join(", ");
    format!(
        "{}|{}|{}|{}|{}|{}|{}|{}|{}|[{}]",
        event.sequence,
        status,
        event.entity_id,
        event.entity_type_id,
        hp,
        hex(&event.initial_transform_raw),
        hex(&event.init_payload_raw),
        loadout,
        class,
        warnings
    )
}

#[test]
fn java_type5_oracle_matches_every_materialization_and_class_evidence() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let golden: Golden = serde_json::from_slice(
        &std::fs::read(root.join("replay-engine/tests/golden/decode-materialization.json"))
            .expect("golden"),
    )
    .expect("valid golden");
    assert_eq!(golden.decoders, ["MaterializationDecoder"]);
    assert_eq!(golden.fixtures.len(), 3);
    for expected in golden.fixtures {
        let archive = std::fs::read(root.join("common/fixtures/replays").join(&expected.name))
            .expect("fixture");
        let source = ReplayArchive::open(&archive)
            .expect("archive")
            .read_stream()
            .expect("stream");
        let packets = PacketStream::open(&source).expect("frames").packets;
        assert_eq!(
            packets.len(),
            expected.packet_count,
            "{} packets",
            expected.name
        );
        let mut rows = Vec::new();
        let registry = DecoderRegistry::materialization_subset();
        let mut context = DecodeContext::default();
        assert_eq!(registry.decoder_names(), ["MaterializationDecoder"]);
        for packet in &packets {
            let result = registry.decode(&mut context, packet, &source);
            if packet.packet_type != 5 {
                assert!(matches!(
                    result.events[0],
                    DecodeEvent::Unknown {
                        reason: "UNSUPPORTED_TYPE",
                        ..
                    }
                ));
                continue;
            }
            let event = match &result.events[0] {
                DecodeEvent::Materialization(event) => event,
                other => panic!("expected materialization, got {other:?}"),
            };
            let class = match context.entity_class.resolve(event.entity_id) {
                EntityClass::Vehicle => "VEHICLE",
                EntityClass::Other => "OTHER",
                EntityClass::Avatar => "AVATAR",
                EntityClass::Unknown => "UNKNOWN",
            };
            rows.push(row(event, &result.warnings, class));
        }
        assert_eq!(rows, expected.rows, "{} Type5 rows", expected.name);
    }
}

#[test]
fn partial_transform_is_zero_filled_like_java() {
    let packet = replay_core::stream::Packet {
        sequence: 1,
        source_offset: 0,
        payload_len: 9,
        packet_type: 5,
        raw_clock_sec: 0.0,
        payload_offset: 0,
    };
    let result = materialization::decode(&packet, &[1, 0, 0, 0, 2, 0, 9, 8, 7], "");
    assert_eq!(
        result.event.expect("envelope").initial_transform_raw,
        [0, 0, 0]
    );
}
