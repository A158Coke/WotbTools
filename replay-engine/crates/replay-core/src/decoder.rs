//! Stateful packet decoding primitives. Entity classes come only from lifecycle evidence.

use std::collections::HashMap;

use crate::stream::Packet;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeStatus {
    Success,
    Partial,
    Unsupported,
    FormatMismatch,
    Malformed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodeWarning {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DecodeEvent {
    /// Type 14 closes the packet stream; its payload is not interpreted.
    StreamClosed { sequence: u32, raw_clock_bits: u32 },
    /// Type 35 is a session counter low byte, not a battle clock.
    SessionDecisecondLowByte {
        sequence: u32,
        raw_clock_bits: u32,
        low8: u8,
    },
    Unknown {
        sequence: u32,
        raw_clock_bits: u32,
        packet_type: u32,
        payload_len: u32,
        reason: &'static str,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodeResult {
    pub status: DecodeStatus,
    pub events: Vec<DecodeEvent>,
    pub warnings: Vec<DecodeWarning>,
}

/// The first independently verifiable decoder slice uses only Type 14 and Type 35.
/// Other packet types remain explicit unsupported events until their decoder is ported.
pub fn decode_battle_end_session(packet: &Packet, source: &[u8]) -> DecodeResult {
    let sequence = packet.sequence;
    let raw_clock_bits = packet.raw_clock_sec.to_bits();
    let payload = packet.payload(source);
    match packet.packet_type {
        14 => DecodeResult {
            status: DecodeStatus::Success,
            events: vec![DecodeEvent::StreamClosed {
                sequence,
                raw_clock_bits,
            }],
            warnings: vec![],
        },
        35 if payload.len() == 1 => DecodeResult {
            status: DecodeStatus::Success,
            events: vec![DecodeEvent::SessionDecisecondLowByte {
                sequence,
                raw_clock_bits,
                low8: payload[0],
            }],
            warnings: vec![],
        },
        35 => DecodeResult {
            status: DecodeStatus::Unsupported,
            events: vec![DecodeEvent::Unknown {
                sequence,
                raw_clock_bits,
                packet_type: 35,
                payload_len: packet.payload_len,
                reason: "TYPE35_LAYOUT_MISMATCH",
            }],
            warnings: vec![DecodeWarning {
                code: "TYPE35_LAYOUT_MISMATCH",
                message: format!("Type35 expected 1-byte payload, got: {}", payload.len()),
            }],
        },
        _ => DecodeResult {
            status: DecodeStatus::Unsupported,
            events: vec![DecodeEvent::Unknown {
                sequence,
                raw_clock_bits,
                packet_type: packet.packet_type,
                payload_len: packet.payload_len,
                reason: "UNSUPPORTED_TYPE",
            }],
            warnings: vec![],
        },
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntityClass {
    Vehicle,
    Avatar,
    Other,
    Unknown,
}

#[derive(Debug, Default)]
pub struct EntityClassRegistry {
    by_id: HashMap<i32, EntityClass>,
}

impl EntityClassRegistry {
    /// Materialization entityTypeId=2. Never replace Avatar or Other evidence.
    pub fn mark_vehicle(&mut self, entity_id: i32) {
        self.by_id
            .entry(entity_id)
            .and_modify(|current| {
                if matches!(current, EntityClass::Unknown | EntityClass::Vehicle) {
                    *current = EntityClass::Vehicle;
                }
            })
            .or_insert(EntityClass::Vehicle);
    }

    /// Recorder account identity wins over earlier lifecycle classification.
    pub fn mark_avatar(&mut self, entity_id: i32) {
        self.by_id.insert(entity_id, EntityClass::Avatar);
    }

    /// Materialization entityTypeId=3 only fills a missing entry.
    pub fn mark_other(&mut self, entity_id: i32) {
        self.by_id.entry(entity_id).or_insert(EntityClass::Other);
    }

    pub fn resolve(&self, entity_id: i32) -> EntityClass {
        self.by_id
            .get(&entity_id)
            .copied()
            .unwrap_or(EntityClass::Unknown)
    }

    pub fn is_classified(&self, entity_id: i32) -> bool {
        self.resolve(entity_id) != EntityClass::Unknown
    }
}

#[cfg(test)]
mod tests {
    use super::{
        decode_battle_end_session, DecodeEvent, DecodeStatus, EntityClass, EntityClassRegistry,
    };
    use crate::stream::Packet;

    fn packet(packet_type: u32, payload_len: u32) -> Packet {
        Packet {
            sequence: 7,
            source_offset: 0,
            payload_len,
            packet_type,
            raw_clock_sec: 1.25,
            payload_offset: 0,
        }
    }

    #[test]
    fn small_decoder_slice_preserves_unknown_semantics() {
        let closed = decode_battle_end_session(&packet(14, 0), &[]);
        assert_eq!(closed.status, DecodeStatus::Success);
        assert_eq!(
            closed.events,
            vec![DecodeEvent::StreamClosed {
                sequence: 7,
                raw_clock_bits: 1.25f32.to_bits()
            }]
        );

        let session = decode_battle_end_session(&packet(35, 1), &[255]);
        assert_eq!(session.status, DecodeStatus::Success);
        assert_eq!(
            session.events,
            vec![DecodeEvent::SessionDecisecondLowByte {
                sequence: 7,
                raw_clock_bits: 1.25f32.to_bits(),
                low8: 255
            }]
        );

        let mismatch = decode_battle_end_session(&packet(35, 0), &[]);
        assert_eq!(mismatch.status, DecodeStatus::Unsupported);
        assert_eq!(mismatch.warnings[0].code, "TYPE35_LAYOUT_MISMATCH");
        assert!(matches!(
            mismatch.events[0],
            DecodeEvent::Unknown {
                reason: "TYPE35_LAYOUT_MISMATCH",
                ..
            }
        ));

        let other = decode_battle_end_session(&packet(8, 0), &[]);
        assert_eq!(other.status, DecodeStatus::Unsupported);
        assert!(matches!(
            other.events[0],
            DecodeEvent::Unknown {
                reason: "UNSUPPORTED_TYPE",
                ..
            }
        ));
    }

    #[test]
    fn lifecycle_evidence_merges_like_java_registry() {
        let mut classes = EntityClassRegistry::default();
        assert_eq!(classes.resolve(1), EntityClass::Unknown);
        assert!(!classes.is_classified(1));

        classes.mark_other(1);
        classes.mark_vehicle(1);
        assert_eq!(classes.resolve(1), EntityClass::Other);

        classes.mark_vehicle(2);
        classes.mark_other(2);
        assert_eq!(classes.resolve(2), EntityClass::Vehicle);

        classes.mark_avatar(1);
        classes.mark_other(1);
        classes.mark_vehicle(1);
        assert_eq!(classes.resolve(1), EntityClass::Avatar);
        assert!(classes.is_classified(1));

        classes.mark_vehicle(3);
        classes.mark_avatar(3);
        assert_eq!(classes.resolve(3), EntityClass::Avatar);
    }
}
