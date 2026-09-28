//! Conservative Java parity for entity create, leave, and materialization announcement.

use crate::stream::Packet;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LifecycleStatus {
    Success,
    Partial,
    Malformed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LifecycleWarning {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LifecycleEvent {
    Created {
        sequence: u32,
        raw_clock_bits: u32,
        packet_type: u32,
        entity_id: i32,
        unknown_init_data: Vec<u8>,
    },
    Removed {
        sequence: u32,
        raw_clock_bits: u32,
        entity_id: i32,
    },
    Announced {
        sequence: u32,
        raw_clock_bits: u32,
        entity_id: i32,
        zero_tail: [u8; 8],
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
pub struct LifecycleResult {
    pub status: LifecycleStatus,
    pub events: Vec<LifecycleEvent>,
    pub warnings: Vec<LifecycleWarning>,
}

pub fn supports(packet_type: u32) -> bool {
    matches!(packet_type, 0 | 1 | 2 | 4 | 33)
}

/// Decode only the five packet types owned by the three Java lifecycle decoders.
/// The registry must validate the packet's source range before passing its payload here.
pub fn decode(packet: &Packet, payload: &[u8]) -> LifecycleResult {
    let sequence = packet.sequence;
    let raw_clock_bits = packet.raw_clock_sec.to_bits();
    let packet_type = packet.packet_type;
    let unknown = |reason| LifecycleEvent::Unknown {
        sequence,
        raw_clock_bits,
        packet_type,
        payload_len: payload.len() as u32,
        reason,
    };
    match packet_type {
        0..=2 => LifecycleResult {
            status: LifecycleStatus::Partial,
            events: vec![LifecycleEvent::Created {
                sequence,
                raw_clock_bits,
                packet_type,
                entity_id: -1,
                unknown_init_data: payload.to_vec(),
            }],
            warnings: vec![LifecycleWarning {
                code: "INIT_DATA_NOT_PARSED",
                message: format!(
                    "Entity create packet type {packet_type}: init data format not yet decoded"
                ),
            }],
        },
        4 if payload.len() < 4 => LifecycleResult {
            status: LifecycleStatus::Malformed,
            events: vec![],
            warnings: vec![LifecycleWarning {
                code: "TRUNCATED_PAYLOAD",
                message: format!("EntityLeave packet too short: {}", payload.len()),
            }],
        },
        4 if payload.len() != 4 => LifecycleResult {
            status: LifecycleStatus::Partial,
            events: vec![unknown("TYPE4_SHAPE_MISMATCH")],
            warnings: vec![LifecycleWarning {
                code: "TYPE4_SHAPE_MISMATCH",
                message: format!("Type4 len={} != proven 4; raw-preserved", payload.len()),
            }],
        },
        4 => LifecycleResult {
            status: LifecycleStatus::Success,
            events: vec![LifecycleEvent::Removed {
                sequence,
                raw_clock_bits,
                entity_id: i32::from_le_bytes(payload[..4].try_into().expect("length checked")),
            }],
            warnings: vec![],
        },
        33 if payload.len() < 4 => LifecycleResult {
            status: LifecycleStatus::Malformed,
            events: vec![],
            warnings: vec![LifecycleWarning {
                code: "TRUNCATED_PAYLOAD",
                message: format!("Type33 packet too short: {}", payload.len()),
            }],
        },
        33 if payload.len() != 12 => LifecycleResult {
            status: LifecycleStatus::Partial,
            events: vec![unknown("TYPE33_SHAPE_MISMATCH")],
            warnings: vec![LifecycleWarning {
                code: "TYPE33_SHAPE_MISMATCH",
                message: format!("Type33 len={} != proven 12; raw-preserved", payload.len()),
            }],
        },
        33 if payload[4..].iter().any(|&b| b != 0) => LifecycleResult {
            status: LifecycleStatus::Partial,
            events: vec![unknown("TYPE33_ZERO_TAIL_NONZERO")],
            warnings: vec![LifecycleWarning {
                code: "TYPE33_ZERO_TAIL_NONZERO",
                message: "Type33 zeroTail not all-zero; raw-preserved".to_owned(),
            }],
        },
        33 => LifecycleResult {
            status: LifecycleStatus::Success,
            events: vec![LifecycleEvent::Announced {
                sequence,
                raw_clock_bits,
                entity_id: i32::from_le_bytes(payload[..4].try_into().expect("length checked")),
                zero_tail: [0; 8],
            }],
            warnings: vec![],
        },
        _ => unreachable!("caller must check supports"),
    }
}
