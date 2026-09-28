//! Stateful packet decoding primitives. Entity classes come only from lifecycle evidence.

use std::collections::HashMap;

use crate::stream::Packet;

pub mod aim_marker;
pub mod ammunition;
pub mod entity_lifecycle;
pub mod materialization;
pub mod position;
pub mod property;

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
    Position(position::PositionEvent),
    Property(property::PropertyEvent),
    Materialization(materialization::MaterializationEvent),
    Ammunition(ammunition::AmmunitionEvent),
    Lifecycle(entity_lifecycle::LifecycleEvent),
    AimMarker(aim_marker::AimMarkerEvent),
    /// Type 14 closes the packet stream; its payload is not interpreted.
    StreamClosed {
        sequence: u32,
        raw_clock_bits: u32,
    },
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

/// Mutable state shared by every decoder in one stream run.
#[derive(Debug, Default)]
pub struct DecodeContext {
    pub replay_version: String,
    pub entity_class: EntityClassRegistry,
}

impl DecodeContext {
    pub fn new(replay_version: impl Into<String>) -> Self {
        Self {
            replay_version: replay_version.into(),
            entity_class: EntityClassRegistry::default(),
        }
    }
}

/// A decoder may inspect the shared state when deciding whether it owns a packet.
pub trait PacketDecoder {
    fn name(&self) -> &'static str;
    fn supports(&self, context: &DecodeContext, packet: &Packet, payload: &[u8]) -> bool;
    fn decode(&self, context: &mut DecodeContext, packet: &Packet, payload: &[u8]) -> DecodeResult;
}

/// Dispatches to the first matching decoder in Java declaration order.
pub struct DecoderRegistry {
    decoders: Vec<Box<dyn PacketDecoder>>,
}

impl DecoderRegistry {
    /// Java-compatible subset for the first event-level parity gate.
    /// The full Java `createDefault()` registry is added only after all 14 decoders exist.
    pub fn battle_end_session_subset() -> Self {
        let mut registry = Self::empty();
        registry.register(BattleEndDecoder);
        registry.register(SessionDecisecondLowByteDecoder);
        registry
    }

    /// Matching Java subset containing only PositionDecoder.
    pub fn position_subset() -> Self {
        let mut registry = Self::empty();
        registry.register(PositionDecoder);
        registry
    }

    /// Matching Java subset containing only EntityPropertyDecoder.
    pub fn property_subset() -> Self {
        let mut registry = Self::empty();
        registry.register(EntityPropertyDecoder);
        registry
    }

    /// Matching Java subset containing only MaterializationDecoder.
    pub fn materialization_subset() -> Self {
        let mut registry = Self::empty();
        registry.register(MaterializationDecoder);
        registry
    }

    /// Matching Java subset containing only AmmunitionSelectionDecoder.
    pub fn ammunition_subset() -> Self {
        let mut registry = Self::empty();
        registry.register(AmmunitionSelectionDecoder);
        registry
    }

    /// Java relative order for entity leave/create/announcement decoders.
    pub fn entity_lifecycle_subset() -> Self {
        let mut registry = Self::empty();
        registry.register(LifecycleDecoder(LifecycleKind::Leave));
        registry.register(LifecycleDecoder(LifecycleKind::Create));
        registry.register(LifecycleDecoder(LifecycleKind::Announced));
        registry
    }

    /// Java relative order for the two recorder aiming decoders.
    pub fn aim_marker_subset() -> Self {
        let mut registry = Self::empty();
        registry.register(AimMarkerDecoder(aim_marker::TYPE_GUN_MARKER_SIZE));
        registry.register(AimMarkerDecoder(aim_marker::TYPE_AIM_RAY_STATE));
        registry
    }

    pub fn empty() -> Self {
        Self {
            decoders: Vec::new(),
        }
    }

    pub fn register(&mut self, decoder: impl PacketDecoder + 'static) {
        self.decoders.push(Box::new(decoder));
    }

    pub fn decoder_names(&self) -> Vec<&'static str> {
        self.decoders.iter().map(|decoder| decoder.name()).collect()
    }

    pub fn decode(
        &self,
        context: &mut DecodeContext,
        packet: &Packet,
        source: &[u8],
    ) -> DecodeResult {
        let payload = packet
            .payload_offset
            .checked_add(packet.payload_len as usize)
            .and_then(|end| source.get(packet.payload_offset..end));
        let Some(payload) = payload else {
            return DecodeResult {
                status: DecodeStatus::Malformed,
                events: vec![DecodeEvent::Unknown {
                    sequence: packet.sequence,
                    raw_clock_bits: packet.raw_clock_sec.to_bits(),
                    packet_type: packet.packet_type,
                    payload_len: packet.payload_len,
                    reason: "TRUNCATED_PACKET",
                }],
                warnings: vec![DecodeWarning {
                    code: "TRUNCATED_PACKET",
                    message: "packet payload exceeds source bytes".to_owned(),
                }],
            };
        };
        for decoder in &self.decoders {
            if decoder.supports(context, packet, payload) {
                return decoder.decode(context, packet, payload);
            }
        }
        unknown(packet, "UNSUPPORTED_TYPE", vec![])
    }
}

fn unknown(packet: &Packet, reason: &'static str, warnings: Vec<DecodeWarning>) -> DecodeResult {
    DecodeResult {
        status: DecodeStatus::Unsupported,
        events: vec![DecodeEvent::Unknown {
            sequence: packet.sequence,
            raw_clock_bits: packet.raw_clock_sec.to_bits(),
            packet_type: packet.packet_type,
            payload_len: packet.payload_len,
            reason,
        }],
        warnings,
    }
}

struct BattleEndDecoder;

struct PositionDecoder;

struct EntityPropertyDecoder;

struct MaterializationDecoder;

struct AmmunitionSelectionDecoder;

enum LifecycleKind {
    Leave,
    Create,
    Announced,
}
struct LifecycleDecoder(LifecycleKind);

impl PacketDecoder for LifecycleDecoder {
    fn name(&self) -> &'static str {
        match self.0 {
            LifecycleKind::Leave => "EntityLeaveDecoder",
            LifecycleKind::Create => "EntityCreateDecoder",
            LifecycleKind::Announced => "MaterializationAnnouncedDecoder",
        }
    }
    fn supports(&self, _: &DecodeContext, packet: &Packet, _: &[u8]) -> bool {
        match self.0 {
            LifecycleKind::Leave => packet.packet_type == 4,
            LifecycleKind::Create => matches!(packet.packet_type, 0..=2),
            LifecycleKind::Announced => packet.packet_type == 33,
        }
    }
    fn decode(&self, _: &mut DecodeContext, packet: &Packet, payload: &[u8]) -> DecodeResult {
        let result = entity_lifecycle::decode(packet, payload);
        DecodeResult {
            status: match result.status {
                entity_lifecycle::LifecycleStatus::Success => DecodeStatus::Success,
                entity_lifecycle::LifecycleStatus::Partial => DecodeStatus::Partial,
                entity_lifecycle::LifecycleStatus::Malformed => DecodeStatus::Malformed,
            },
            events: result
                .events
                .into_iter()
                .map(DecodeEvent::Lifecycle)
                .collect(),
            warnings: result
                .warnings
                .into_iter()
                .map(|warning| DecodeWarning {
                    code: warning.code,
                    message: warning.message,
                })
                .collect(),
        }
    }
}

struct AimMarkerDecoder(u32);

impl PacketDecoder for AimMarkerDecoder {
    fn name(&self) -> &'static str {
        match self.0 {
            aim_marker::TYPE_GUN_MARKER_SIZE => "GunMarkerSizeDecoder",
            aim_marker::TYPE_AIM_RAY_STATE => "AimRayStateDecoder",
            _ => unreachable!("only two aim marker decoders are registered"),
        }
    }
    fn supports(&self, _: &DecodeContext, packet: &Packet, _: &[u8]) -> bool {
        packet.packet_type == self.0
    }
    fn decode(&self, _: &mut DecodeContext, packet: &Packet, payload: &[u8]) -> DecodeResult {
        let result = aim_marker::decode(packet.packet_type, payload);
        DecodeResult {
            status: if result.warning.is_some() {
                DecodeStatus::Malformed
            } else {
                DecodeStatus::Success
            },
            events: vec![DecodeEvent::AimMarker(result.event)],
            warnings: result
                .warning
                .into_iter()
                .map(|(code, message)| DecodeWarning { code, message })
                .collect(),
        }
    }
}

impl PacketDecoder for AmmunitionSelectionDecoder {
    fn name(&self) -> &'static str {
        "AmmunitionSelectionDecoder"
    }
    fn supports(&self, _: &DecodeContext, packet: &Packet, _: &[u8]) -> bool {
        packet.packet_type == ammunition::TYPE_AMMUNITION_SELECTION
    }
    fn decode(&self, _: &mut DecodeContext, packet: &Packet, payload: &[u8]) -> DecodeResult {
        let result = ammunition::decode(packet, payload);
        DecodeResult {
            status: if result.malformed {
                DecodeStatus::Malformed
            } else if result.partial {
                DecodeStatus::Partial
            } else {
                DecodeStatus::Success
            },
            events: vec![DecodeEvent::Ammunition(result.event)],
            warnings: result
                .warning
                .into_iter()
                .map(|(code, message)| DecodeWarning { code, message })
                .collect(),
        }
    }
}

impl PacketDecoder for MaterializationDecoder {
    fn name(&self) -> &'static str {
        "MaterializationDecoder"
    }
    fn supports(&self, _: &DecodeContext, packet: &Packet, _: &[u8]) -> bool {
        packet.packet_type == materialization::TYPE_MATERIALIZATION
    }
    fn decode(&self, context: &mut DecodeContext, packet: &Packet, payload: &[u8]) -> DecodeResult {
        let result = materialization::decode(packet, payload, &context.replay_version);
        if let Some(event) = &result.event {
            match event.entity_type_id {
                2 => context.entity_class.mark_vehicle(event.entity_id),
                3 => context.entity_class.mark_other(event.entity_id),
                _ => {}
            }
        }
        DecodeResult {
            status: if result.event.is_none() {
                DecodeStatus::Malformed
            } else if result.warnings.is_empty() {
                DecodeStatus::Success
            } else {
                DecodeStatus::Partial
            },
            events: result
                .event
                .into_iter()
                .map(DecodeEvent::Materialization)
                .collect(),
            warnings: result
                .warnings
                .into_iter()
                .map(|warning| DecodeWarning {
                    code: warning.code,
                    message: warning.message,
                })
                .collect(),
        }
    }
}

impl PacketDecoder for EntityPropertyDecoder {
    fn name(&self) -> &'static str {
        "EntityPropertyDecoder"
    }
    fn supports(&self, _: &DecodeContext, packet: &Packet, _: &[u8]) -> bool {
        packet.packet_type == property::TYPE_ENTITY_PROPERTY
    }
    fn decode(&self, _: &mut DecodeContext, packet: &Packet, payload: &[u8]) -> DecodeResult {
        let mut local = packet.clone();
        local.payload_offset = 0;
        let result = property::decode_property(&local, payload);
        let status = match result.status {
            property::PropertyStatus::Success => DecodeStatus::Success,
            property::PropertyStatus::Partial => DecodeStatus::Partial,
            property::PropertyStatus::Malformed => DecodeStatus::Malformed,
        };
        DecodeResult {
            status,
            events: result
                .events
                .into_iter()
                .map(DecodeEvent::Property)
                .collect(),
            warnings: result
                .warnings
                .into_iter()
                .map(|warning| DecodeWarning {
                    code: warning.code,
                    message: warning.message,
                })
                .collect(),
        }
    }
}

impl PacketDecoder for PositionDecoder {
    fn name(&self) -> &'static str {
        "PositionDecoder"
    }
    fn supports(&self, _: &DecodeContext, packet: &Packet, _: &[u8]) -> bool {
        packet.packet_type == position::TYPE_POSITION
    }
    fn decode(&self, _: &mut DecodeContext, packet: &Packet, payload: &[u8]) -> DecodeResult {
        // The position module consumes a Packet offset into its source. A payload slice is its
        // complete source, so reset the offset without changing any packet metadata.
        let mut local = packet.clone();
        local.payload_offset = 0;
        let result = position::decode_position(&local, payload);
        let status = match result.status {
            position::PositionStatus::Success => DecodeStatus::Success,
            position::PositionStatus::Partial => DecodeStatus::Partial,
            position::PositionStatus::Malformed => DecodeStatus::Malformed,
        };
        DecodeResult {
            status,
            events: vec![DecodeEvent::Position(result.event)],
            warnings: result
                .warnings
                .into_iter()
                .map(|warning| DecodeWarning {
                    code: warning.code,
                    message: warning.message,
                })
                .collect(),
        }
    }
}

impl PacketDecoder for BattleEndDecoder {
    fn name(&self) -> &'static str {
        "BattleEndDecoder"
    }
    fn supports(&self, _: &DecodeContext, packet: &Packet, _: &[u8]) -> bool {
        packet.packet_type == 14
    }
    fn decode(&self, _: &mut DecodeContext, packet: &Packet, _: &[u8]) -> DecodeResult {
        DecodeResult {
            status: DecodeStatus::Success,
            events: vec![DecodeEvent::StreamClosed {
                sequence: packet.sequence,
                raw_clock_bits: packet.raw_clock_sec.to_bits(),
            }],
            warnings: vec![],
        }
    }
}

struct SessionDecisecondLowByteDecoder;

impl PacketDecoder for SessionDecisecondLowByteDecoder {
    fn name(&self) -> &'static str {
        "SessionDecisecondLowByteDecoder"
    }
    fn supports(&self, _: &DecodeContext, packet: &Packet, _: &[u8]) -> bool {
        packet.packet_type == 35
    }
    fn decode(&self, _: &mut DecodeContext, packet: &Packet, payload: &[u8]) -> DecodeResult {
        if payload.len() == 1 {
            DecodeResult {
                status: DecodeStatus::Success,
                events: vec![DecodeEvent::SessionDecisecondLowByte {
                    sequence: packet.sequence,
                    raw_clock_bits: packet.raw_clock_sec.to_bits(),
                    low8: payload[0],
                }],
                warnings: vec![],
            }
        } else {
            unknown(
                packet,
                "TYPE35_LAYOUT_MISMATCH",
                vec![DecodeWarning {
                    code: "TYPE35_LAYOUT_MISMATCH",
                    message: format!("Type35 expected 1-byte payload, got: {}", payload.len()),
                }],
            )
        }
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
        DecodeContext, DecodeEvent, DecodeResult, DecodeStatus, DecoderRegistry, EntityClass,
        EntityClassRegistry, PacketDecoder,
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

    fn decode_battle_end_session(packet: &Packet, source: &[u8]) -> DecodeResult {
        DecoderRegistry::battle_end_session_subset().decode(
            &mut DecodeContext::default(),
            packet,
            source,
        )
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

    struct MarkerDecoder(&'static str, u8);

    impl PacketDecoder for MarkerDecoder {
        fn name(&self) -> &'static str {
            self.0
        }
        fn supports(&self, context: &DecodeContext, packet: &Packet, _: &[u8]) -> bool {
            packet.packet_type == 8 && context.entity_class.resolve(42) == EntityClass::Vehicle
        }
        fn decode(&self, _: &mut DecodeContext, packet: &Packet, _: &[u8]) -> DecodeResult {
            DecodeResult {
                status: DecodeStatus::Success,
                events: vec![DecodeEvent::SessionDecisecondLowByte {
                    sequence: packet.sequence,
                    raw_clock_bits: packet.raw_clock_sec.to_bits(),
                    low8: self.1,
                }],
                warnings: vec![],
            }
        }
    }

    #[test]
    fn registry_preserves_order_shared_context_and_unsupported_fallback() {
        let mut registry = DecoderRegistry::empty();
        registry.register(MarkerDecoder("first", 1));
        registry.register(MarkerDecoder("second", 2));
        assert_eq!(registry.decoder_names(), ["first", "second"]);
        let mut context = DecodeContext::new("1.2.3");
        assert_eq!(context.replay_version, "1.2.3");
        let unclassified = registry.decode(&mut context, &packet(8, 0), &[]);
        assert_eq!(unclassified.status, DecodeStatus::Unsupported);
        assert!(matches!(
            unclassified.events[0],
            DecodeEvent::Unknown {
                reason: "UNSUPPORTED_TYPE",
                ..
            }
        ));
        context.entity_class.mark_vehicle(42);
        let classified = registry.decode(&mut context, &packet(8, 0), &[]);
        assert!(matches!(
            classified.events[0],
            DecodeEvent::SessionDecisecondLowByte { low8: 1, .. }
        ));
        assert_eq!(
            DecoderRegistry::battle_end_session_subset().decoder_names(),
            ["BattleEndDecoder", "SessionDecisecondLowByteDecoder"]
        );
    }

    #[test]
    fn registry_rejects_truncated_payload_without_panicking() {
        let registry = DecoderRegistry::position_subset();
        let result = registry.decode(&mut DecodeContext::default(), &packet(10, 49), &[]);
        assert_eq!(result.status, DecodeStatus::Malformed);
        assert!(matches!(
            result.events[0],
            DecodeEvent::Unknown {
                reason: "TRUNCATED_PACKET",
                ..
            }
        ));
    }
}
