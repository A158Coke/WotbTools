//! Java Type28 recorder-local ammunition selection. The value is not an ammunition type.

use crate::stream::Packet;

pub const TYPE_AMMUNITION_SELECTION: u32 = 28;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AmmunitionEvent {
    Selection {
        sequence: u32,
        raw_clock_bits: u32,
        value: i32,
        exact: bool,
    },
    Unknown {
        sequence: u32,
        raw_clock_bits: u32,
        payload_len: u32,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AmmunitionResult {
    pub event: AmmunitionEvent,
    pub malformed: bool,
    pub partial: bool,
    pub warning: Option<(&'static str, String)>,
}

pub fn decode(packet: &Packet, payload: &[u8]) -> AmmunitionResult {
    let sequence = packet.sequence;
    let raw_clock_bits = packet.raw_clock_sec.to_bits();
    if payload.len() != 4 {
        return AmmunitionResult {
            event: AmmunitionEvent::Unknown {
                sequence,
                raw_clock_bits,
                payload_len: packet.payload_len,
            },
            malformed: true,
            partial: false,
            warning: Some((
                "TYPE28_LAYOUT_MISMATCH",
                format!("Type28 expected 4 bytes, got {}", payload.len()),
            )),
        };
    }
    let value = i32::from_le_bytes(payload.try_into().expect("4-byte payload"));
    let exact = value <= 2;
    AmmunitionResult {
        event: AmmunitionEvent::Selection {
            sequence,
            raw_clock_bits,
            value,
            exact,
        },
        malformed: false,
        partial: !exact,
        warning: (!exact).then(|| {
            (
                "SELECTION_VALUE_OUT_OF_DOMAIN",
                format!("Type28 selectionValue={value} outside observed domain {{0,1,2}}"),
            )
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn packet(len: u32) -> Packet {
        Packet {
            sequence: 1,
            source_offset: 0,
            payload_len: len,
            packet_type: 28,
            raw_clock_sec: 1.5,
            payload_offset: 0,
        }
    }

    #[test]
    fn shape_and_signed_domain_match_java() {
        assert!(decode(&packet(0), &[]).malformed);
        assert!(!decode(&packet(4), &2i32.to_le_bytes()).partial);
        assert!(decode(&packet(4), &3i32.to_le_bytes()).partial);
        // Java readU32LE returns a signed int; negative values are <= 2.
        let negative = decode(&packet(4), &(-1i32).to_le_bytes());
        assert!(!negative.partial);
        assert!(matches!(
            negative.event,
            AmmunitionEvent::Selection {
                value: -1,
                exact: true,
                ..
            }
        ));
    }
}
