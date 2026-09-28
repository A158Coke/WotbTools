//! Java Type 5 materialization envelope, HP snapshot and battle loadout.

use crate::stream::Packet;

pub const TYPE_MATERIALIZATION: u32 = 5;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoadoutItemSlot {
    pub slot: usize,
    pub wire_code: u8,
    pub state_raw: u8,
    pub payload_raw: [u8; 12],
    pub logical_item_id: Option<&'static str>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VehicleBattleLoadout {
    pub entity_id: i32,
    pub replay_version: String,
    pub consumables: Vec<LoadoutItemSlot>,
    pub provisions: Vec<LoadoutItemSlot>,
    pub equipment: [u8; 9],
    pub partial: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MaterializationEvent {
    pub sequence: u32,
    pub raw_clock_bits: u32,
    pub entity_id: i32,
    pub entity_type_id: u16,
    pub current_hp: Option<u16>,
    pub initial_transform_raw: Vec<u8>,
    pub init_payload_raw: Vec<u8>,
    pub loadout: Option<VehicleBattleLoadout>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MaterializationWarning {
    pub code: &'static str,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MaterializationResult {
    pub event: Option<MaterializationEvent>,
    pub warnings: Vec<MaterializationWarning>,
}

pub fn envelope(payload: &[u8]) -> Option<(i32, u16)> {
    let entity_id = i32::from_le_bytes(payload.get(..4)?.try_into().ok()?);
    let entity_type_id = u16::from_le_bytes(payload.get(4..6)?.try_into().ok()?);
    Some((entity_id, entity_type_id))
}

pub fn decode(packet: &Packet, payload: &[u8], replay_version: &str) -> MaterializationResult {
    let Some((entity_id, entity_type_id)) = envelope(payload) else {
        return MaterializationResult {
            event: None,
            warnings: vec![MaterializationWarning {
                code: "TRUNCATED_PAYLOAD",
                message: format!("Type5 packet too short: {}", payload.len()),
            }],
        };
    };
    let mut warnings = Vec::new();
    let current_hp = if entity_type_id == 2 {
        if payload.len() < 53 {
            warnings.push(MaterializationWarning {
                code: "MATERIALIZATION_HP_TRUNCATED",
                message: format!(
                    "Type5 vehicle payload shorter than HP offset 51: {}",
                    payload.len()
                ),
            });
            None
        } else {
            let raw = u16::from_le_bytes([payload[51], payload[52]]);
            if raw > 0 && raw < 0xff00 {
                Some(raw)
            } else {
                warnings.push(MaterializationWarning {
                    code: "MATERIALIZATION_HP_SENTINEL",
                    message: format!(
                        "Type5 hpRaw=0x{raw:x} treated as UNKNOWN at entity {entity_id}"
                    ),
                });
                None
            }
        }
    } else {
        None
    };
    // Java allocates the available prefix length but leaves it zero-filled unless all 8 bytes exist.
    let initial_transform_raw = if payload.len() >= 14 {
        payload[6..14].to_vec()
    } else {
        vec![0; payload.len().saturating_sub(6)]
    };
    let init_payload_raw = payload.get(14..).unwrap_or_default().to_vec();
    let loadout = if entity_type_id == 2 {
        parse_loadout(entity_id, replay_version, &init_payload_raw)
    } else {
        None
    };
    MaterializationResult {
        event: Some(MaterializationEvent {
            sequence: packet.sequence,
            raw_clock_bits: packet.raw_clock_sec.to_bits(),
            entity_id,
            entity_type_id,
            current_hp,
            initial_transform_raw,
            init_payload_raw,
            loadout,
        }),
        warnings,
    }
}

pub fn parse_loadout(
    entity_id: i32,
    replay_version: &str,
    init: &[u8],
) -> Option<VehicleBattleLoadout> {
    let marker = init.windows(2).position(|w| w == [0x0a, 0x06])?;
    let start = marker + 2;
    let equipment_marker = start + 6 * 14;
    if init.get(equipment_marker..equipment_marker + 2)? != [0x0b, 0x09] {
        return None;
    }
    let equipment: [u8; 9] = init
        .get(equipment_marker + 2..equipment_marker + 11)?
        .try_into()
        .ok()?;
    let mut consumables = Vec::with_capacity(3);
    let mut provisions = Vec::with_capacity(3);
    let mut partial = false;
    for slot in 0..6 {
        let base = start + slot * 14;
        let wire_code = init[base];
        let logical_item_id = logical_item_id(wire_code, slot < 3);
        if logical_item_id.is_none() && wire_code != 0 {
            partial = true;
        }
        let item = LoadoutItemSlot {
            slot,
            wire_code,
            state_raw: init[base + 1],
            payload_raw: init[base + 2..base + 14].try_into().ok()?,
            logical_item_id,
        };
        if slot < 3 {
            consumables.push(item);
        } else {
            provisions.push(item);
        }
    }
    Some(VehicleBattleLoadout {
        entity_id,
        replay_version: replay_version.to_owned(),
        consumables,
        provisions,
        equipment,
        partial,
    })
}

fn logical_item_id(code: u8, consumable: bool) -> Option<&'static str> {
    if consumable {
        return match code {
            0x08 => Some("AUTOMATIC_FIRE_EXTINGUISHER"),
            0x09 => Some("ADRENALINE"),
            0x0a => Some("ENGINE_POWER_BOOST"),
            0x0b => Some("MULTI_PURPOSE_RESTORATION_PACK"),
            0x0c => Some("FIRST_AID_KIT"),
            0x0d => Some("REPAIR_KIT"),
            0x3d => Some("IMPROVED_ENGINE_POWER_BOOST"),
            0x3e => Some("RETICLE_CALIBRATION"),
            0x42 => Some("REACTIVE_ARMOR"),
            0x69 => Some("TUNGSTEN_SHELLS"),
            0xbd => Some("REDUCED_ENGINE_POWER_BOOST"),
            _ => None,
        };
    }
    match code {
        0x0e..=0x12 | 0x46 | 0x49 => Some("LARGE_FOOD"),
        0x16..=0x19 | 0x47 | 0x48 => Some("SMALL_FOOD"),
        0x1c => Some("STANDARD_FUEL"),
        0x1d => Some("IMPROVED_FUEL"),
        0x1e => Some("PROTECTIVE_KIT"),
        0x44 => Some("SANDBAG_ARMOR"),
        0x45 => Some("ENHANCED_SANDBAG_ARMOR"),
        0x6a => Some("GEAR_OIL"),
        0x6b => Some("IMPROVED_GEAR_OIL"),
        0x6c => Some("IMPROVED_GUNPOWDER"),
        _ => None,
    }
}
