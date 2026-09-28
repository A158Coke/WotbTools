//! Java `EntityPropertyDecoder` Type 7 envelope and property semantics.
//!
//! The registry routes Type 7 here and wraps its events in the shared decode model.

use crate::stream::Packet;

pub const TYPE_ENTITY_PROPERTY: u32 = 7;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PropertyStatus {
    Success,
    Partial,
    Malformed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HpRawState {
    CurrentHp,
    HpZeroTerminal,
    DeathTerminalFffd,
    UnknownFfff,
    UnknownOther,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PropertyWarning {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PropertyEvent {
    Health {
        sequence: u32,
        raw_clock_bits: u32,
        entity_id: i32,
        current_health: Option<i32>,
        alive: Option<bool>,
        raw_current_health: u16,
        raw_state: HpRawState,
        exact: bool,
    },
    TurretDirection {
        sequence: u32,
        raw_clock_bits: u32,
        entity_id: i32,
        /// Java double bit pattern for `raw * 360.0 / 65536.0 - 180.0`.
        relative_yaw_deg_bits: u64,
    },
    Unknown {
        sequence: u32,
        raw_clock_bits: u32,
        payload_len: u32,
        reason: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PropertyResult {
    pub status: PropertyStatus,
    pub events: Vec<PropertyEvent>,
    pub warnings: Vec<PropertyWarning>,
}

/// Decode a routed Type 7 packet. The packet offset and declared length must fit `source`.
pub fn decode_property(packet: &Packet, source: &[u8]) -> PropertyResult {
    let len = packet.payload_len as usize;
    let payload = packet
        .payload_offset
        .checked_add(len)
        .and_then(|end| source.get(packet.payload_offset..end));
    let Some(payload) = payload else {
        return PropertyResult {
            status: PropertyStatus::Malformed,
            events: vec![],
            warnings: vec![PropertyWarning {
                code: "TRUNCATED_PAYLOAD",
                message: format!("EntityProperty packet too short: {len}"),
            }],
        };
    };
    if payload.len() < 12 {
        return PropertyResult {
            status: PropertyStatus::Malformed,
            events: vec![],
            warnings: vec![PropertyWarning {
                code: "TRUNCATED_PAYLOAD",
                message: format!("EntityProperty packet too short: {}", payload.len()),
            }],
        };
    }
    let read_u32 = |offset: usize| -> u32 {
        u32::from_le_bytes(
            payload[offset..offset + 4]
                .try_into()
                .expect("checked header"),
        )
    };
    let entity_id = read_u32(0) as i32;
    let prop_id = read_u32(4) as i32;
    let value_len = read_u32(8) as i32;
    let unknown = |reason: String| PropertyEvent::Unknown {
        sequence: packet.sequence,
        raw_clock_bits: packet.raw_clock_sec.to_bits(),
        payload_len: packet.payload_len,
        reason,
    };
    // Java uses signed int addition here, including wrapping semantics for malicious u32 lengths.
    if value_len < 0 || 12_i32.wrapping_add(value_len) != payload.len() as i32 {
        return PropertyResult {
            status: PropertyStatus::Malformed,
            events: vec![unknown("ENTITY_PROPERTY_LENGTH_MISMATCH".into())],
            warnings: vec![PropertyWarning {
                code: "PROPERTY_VALUE_LENGTH_MISMATCH",
                message: format!(
                    "EntityProperty valueLen={value_len} payload={} entity={entity_id}",
                    payload.len()
                ),
            }],
        };
    }
    if value_len == 2 && prop_id == 3 {
        let raw = u16::from_le_bytes([payload[12], payload[13]]);
        let (state, hp, alive, exact) = match raw {
            0 => (HpRawState::HpZeroTerminal, Some(0), Some(false), true),
            0xfffd => (HpRawState::DeathTerminalFffd, None, Some(false), true),
            0xffff => (HpRawState::UnknownFfff, None, None, false),
            1..=0x7fff => (
                HpRawState::CurrentHp,
                Some(i32::from(raw)),
                Some(true),
                true,
            ),
            _ => (HpRawState::UnknownOther, None, None, false),
        };
        return PropertyResult {
            status: if exact {
                PropertyStatus::Success
            } else {
                PropertyStatus::Partial
            },
            events: vec![PropertyEvent::Health {
                sequence: packet.sequence,
                raw_clock_bits: packet.raw_clock_sec.to_bits(),
                entity_id,
                current_health: hp,
                alive,
                raw_current_health: raw,
                raw_state: state,
                exact,
            }],
            warnings: if exact {
                vec![]
            } else {
                vec![PropertyWarning {
                    code: "HP_SENTINEL_UNKNOWN",
                    message: format!(
                        "prop3 raw=0x{raw:x} preserved as UNKNOWN at entity {entity_id}"
                    ),
                }]
            },
        };
    }
    if value_len == 2 && prop_id == 2 {
        let raw = u16::from_le_bytes([payload[12], payload[13]]);
        let deg = f64::from(raw) * (360.0_f64 / 65536.0_f64) - 180.0_f64;
        return PropertyResult {
            status: PropertyStatus::Success,
            events: vec![PropertyEvent::TurretDirection {
                sequence: packet.sequence,
                raw_clock_bits: packet.raw_clock_sec.to_bits(),
                entity_id,
                relative_yaw_deg_bits: deg.to_bits(),
            }],
            warnings: vec![],
        };
    }
    PropertyResult {
        status: PropertyStatus::Partial,
        events: vec![unknown(format!(
            "ENTITY_PROPERTY_prop{prop_id}_len{value_len}"
        ))],
        warnings: vec![],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_packet(prop: u32, value: &[u8]) -> (Packet, Vec<u8>) {
        let mut payload = Vec::new();
        payload.extend(12_345_i32.to_le_bytes());
        payload.extend(prop.to_le_bytes());
        payload.extend((value.len() as u32).to_le_bytes());
        payload.extend(value);
        let packet = Packet {
            sequence: 1,
            source_offset: 0,
            payload_len: payload.len() as u32,
            packet_type: 7,
            raw_clock_sec: 10.0,
            payload_offset: 0,
        };
        (packet, payload)
    }

    #[test]
    fn turret_wire_mapping_has_exact_endpoints() {
        for (raw, expected) in [
            (0_u16, -180.0_f64),
            (32768, 0.0_f64),
            (65535, 180.0_f64 - 360.0 / 65536.0),
        ] {
            let (packet, payload) = make_packet(2, &raw.to_le_bytes());
            let result = decode_property(&packet, &payload);
            assert_eq!(result.status, PropertyStatus::Success);
            assert_eq!(result.warnings, []);
            assert_eq!(
                result.events,
                [PropertyEvent::TurretDirection {
                    sequence: 1,
                    raw_clock_bits: 10.0_f32.to_bits(),
                    entity_id: 12_345,
                    relative_yaw_deg_bits: expected.to_bits(),
                }]
            );
        }
    }

    #[test]
    fn hp_sentinels_preserve_terminal_distinction() {
        for (raw, state, hp, alive, exact) in [
            (
                2966_u16,
                HpRawState::CurrentHp,
                Some(2966),
                Some(true),
                true,
            ),
            (0, HpRawState::HpZeroTerminal, Some(0), Some(false), true),
            (
                0xfffd,
                HpRawState::DeathTerminalFffd,
                None,
                Some(false),
                true,
            ),
            (0xffff, HpRawState::UnknownFfff, None, None, false),
            (0xfffe, HpRawState::UnknownOther, None, None, false),
        ] {
            let (packet, payload) = make_packet(3, &raw.to_le_bytes());
            let result = decode_property(&packet, &payload);
            assert_eq!(
                result.status,
                if exact {
                    PropertyStatus::Success
                } else {
                    PropertyStatus::Partial
                }
            );
            assert_eq!(result.warnings.len(), usize::from(!exact));
            assert_eq!(
                result.events,
                [PropertyEvent::Health {
                    sequence: 1,
                    raw_clock_bits: 10.0_f32.to_bits(),
                    entity_id: 12_345,
                    current_health: hp,
                    alive,
                    raw_current_health: raw,
                    raw_state: state,
                    exact,
                }]
            );
        }
    }

    #[test]
    fn malformed_and_unrecognized_property_preserve_java_outcomes() {
        let (packet, payload) = make_packet(2, &[1]);
        let unknown = decode_property(&packet, &payload);
        assert_eq!(unknown.status, PropertyStatus::Partial);
        assert!(
            matches!(&unknown.events[0], PropertyEvent::Unknown { reason, .. } if reason == "ENTITY_PROPERTY_prop2_len1")
        );

        let mut mismatch = payload.clone();
        mismatch[8] = 2;
        let result = decode_property(&packet, &mismatch);
        assert_eq!(result.status, PropertyStatus::Malformed);
        assert_eq!(result.warnings[0].code, "PROPERTY_VALUE_LENGTH_MISMATCH");

        let mut short_packet = packet;
        short_packet.payload_len = 11;
        let result = decode_property(&short_packet, &payload);
        assert_eq!(result.status, PropertyStatus::Malformed);
        assert!(result.events.is_empty());
        assert_eq!(result.warnings[0].code, "TRUNCATED_PAYLOAD");

        let (signed_packet, signed_payload) = make_packet(0xffff_ffff, &[]);
        let result = decode_property(&signed_packet, &signed_payload);
        assert!(
            matches!(&result.events[0], PropertyEvent::Unknown { reason, .. } if reason == "ENTITY_PROPERTY_prop-1_len0")
        );
    }
}
