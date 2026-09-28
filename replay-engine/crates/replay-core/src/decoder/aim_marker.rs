//! Type 31 and 39 recorder samples. Values retain their original IEEE-754 bits.

pub const TYPE_GUN_MARKER_SIZE: u32 = 31;
pub const TYPE_AIM_RAY_STATE: u32 = 39;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AimMarkerEvent {
    GunMarkerSize { bits: u32 },
    AimRayState { bits: [u32; 7] },
    Unknown { reason: &'static str },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AimMarkerResult {
    pub event: AimMarkerEvent,
    pub warning: Option<(&'static str, String)>,
}

/// Caller routes only Type 31/39 here. Invalid layouts and non-finite values are malformed.
pub fn decode(packet_type: u32, payload: &[u8]) -> AimMarkerResult {
    let (expected, label) = match packet_type {
        TYPE_GUN_MARKER_SIZE => (4, "Type31"),
        TYPE_AIM_RAY_STATE => (28, "Type39"),
        _ => panic!("aim-marker decoder received unsupported packet type"),
    };
    if payload.len() != expected {
        let reason = if packet_type == TYPE_GUN_MARKER_SIZE {
            "TYPE31_LAYOUT_MISMATCH"
        } else {
            "TYPE39_LAYOUT_MISMATCH"
        };
        return AimMarkerResult {
            event: AimMarkerEvent::Unknown { reason },
            warning: Some((
                reason,
                format!("{label} expected {expected} bytes, got {}", payload.len()),
            )),
        };
    }
    let bits: Vec<u32> = payload
        .as_chunks::<4>()
        .0
        .iter()
        .map(|chunk| u32::from_le_bytes(*chunk))
        .collect();
    if let Some(index) = bits
        .iter()
        .position(|bits| !f32::from_bits(*bits).is_finite())
    {
        let reason = if packet_type == TYPE_GUN_MARKER_SIZE {
            "TYPE31_NON_FINITE"
        } else {
            "TYPE39_NON_FINITE"
        };
        let message = if packet_type == TYPE_GUN_MARKER_SIZE {
            "Type31 marker size is non-finite".to_owned()
        } else {
            format!("Type39 contains non-finite float at index {index}")
        };
        return AimMarkerResult {
            event: AimMarkerEvent::Unknown { reason },
            warning: Some((reason, message)),
        };
    }
    AimMarkerResult {
        event: if packet_type == TYPE_GUN_MARKER_SIZE {
            AimMarkerEvent::GunMarkerSize { bits: bits[0] }
        } else {
            AimMarkerEvent::AimRayState {
                bits: bits.try_into().expect("seven floats"),
            }
        },
        warning: None,
    }
}
