//! Java `PositionDecoder` Type 10 layout. This module is deliberately independent of the
//! surrounding registry until the decoder event model is wired together.

use crate::stream::Packet;

pub const TYPE_POSITION: u32 = 10;
pub const PAYLOAD_LEN: usize = 49;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PositionStatus {
    Success,
    Partial,
    Malformed,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PositionWarning {
    pub code: &'static str,
    pub message: String,
}

/// Raw float bits preserve signed zero and NaN payloads across the Java/Rust boundary.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transform {
    pub sequence: u32,
    pub raw_clock_bits: u32,
    pub entity_id: i32,
    pub space_id: i32,
    pub attachment_parent_entity_id: i32,
    /// x, y, z, errorX, errorY, errorZ, yaw, pitch, roll in Java declaration order.
    pub float_bits: [u32; 9],
    pub trailing_state_raw: u8,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PositionEvent {
    World(Transform),
    Attached(Transform),
    Unknown {
        sequence: u32,
        raw_clock_bits: u32,
        payload_len: u32,
        reason: &'static str,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PositionResult {
    pub status: PositionStatus,
    pub event: PositionEvent,
    pub warnings: Vec<PositionWarning>,
}

/// Decode a Type 10 packet. The caller must route packet types; malformed offsets fail closed.
pub fn decode_position(packet: &Packet, source: &[u8]) -> PositionResult {
    let raw_clock_bits = packet.raw_clock_sec.to_bits();
    let start = packet.payload_offset;
    let payload = (packet.payload_len as usize == PAYLOAD_LEN)
        .then(|| start.checked_add(PAYLOAD_LEN))
        .flatten()
        .and_then(|end| source.get(start..end));
    let Some(payload) = payload else {
        return PositionResult {
            status: PositionStatus::Malformed,
            event: PositionEvent::Unknown {
                sequence: packet.sequence,
                raw_clock_bits,
                payload_len: packet.payload_len,
                reason: "TYPE10_LAYOUT_MISMATCH",
            },
            warnings: vec![PositionWarning {
                code: "TYPE10_LAYOUT_MISMATCH",
                message: format!("Type10 expected 49 bytes, got {}", packet.payload_len),
            }],
        };
    };
    let read_u32 = |offset: usize| {
        u32::from_le_bytes(
            payload[offset..offset + 4]
                .try_into()
                .expect("49-byte layout"),
        )
    };
    let entity_id = read_u32(0) as i32;
    let space_id = read_u32(4) as i32;
    let attachment_parent_entity_id = read_u32(8) as i32;
    let float_bits = std::array::from_fn(|i| read_u32(12 + i * 4));
    let values: [f32; 9] = float_bits.map(f32::from_bits);
    let mut warnings = Vec::new();
    let non_finite = values.iter().any(|value| !value.is_finite());
    if non_finite {
        warnings.push(PositionWarning {
            code: "TYPE10_NON_FINITE",
            message: format!("Type10 contains NaN/Infinity at entity {entity_id}"),
        });
    }
    if values[..3].iter().all(|value| value.is_finite())
        && (values[0].abs() > 5000.0 || values[2].abs() > 5000.0 || values[1].abs() > 200.0)
    {
        warnings.push(PositionWarning {
            code: "OUT_OF_BOUNDS",
            message: format!(
                "Type10 position out of bounds at entity {entity_id}: {},{},{}",
                values[0], values[1], values[2]
            ),
        });
    }
    let transform = Transform {
        sequence: packet.sequence,
        raw_clock_bits,
        entity_id,
        space_id,
        attachment_parent_entity_id,
        float_bits,
        trailing_state_raw: payload[48],
    };
    PositionResult {
        status: if non_finite {
            PositionStatus::Partial
        } else {
            PositionStatus::Success
        },
        event: if attachment_parent_entity_id == 0 {
            PositionEvent::World(transform)
        } else {
            PositionEvent::Attached(transform)
        },
        warnings,
    }
}
