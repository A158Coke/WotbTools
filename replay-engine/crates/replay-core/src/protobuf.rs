//! Generic protobuf field walker.
//!
//! Mirrors the production decoder (`com.wotb.core.parse.Protobuf`): field-number -> value list,
//! with the same hard caps so a malformed message cannot exhaust memory. No generated message types
//! and no `prost`: the settlement schema is read by tag, and unknown fields stay untouched.

use crate::error::ReplayError;

pub const MAX_MESSAGE_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_VALUES: usize = 16_384;
pub const MAX_VARINT_BYTES: usize = 10;
pub const MAX_FIELD_NUMBER: u32 = (1 << 29) - 1;

const WIRE_VARINT: u32 = 0;
const WIRE_FIXED64: u32 = 1;
const WIRE_LEN: u32 = 2;
const WIRE_FIXED32: u32 = 5;

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Varint(u64),
    Fixed64(u64),
    Bytes(Vec<u8>),
    Fixed32(u32),
}

impl Value {
    pub fn as_u64(&self) -> Option<u64> {
        match self {
            Value::Varint(v) => Some(*v),
            Value::Fixed64(v) => Some(*v),
            Value::Fixed32(v) => Some(u64::from(*v)),
            Value::Bytes(_) => None,
        }
    }

    /// Protobuf `int32`/`int64` are sign-extended into the varint, so the raw bits are the value.
    pub fn as_i64(&self) -> Option<i64> {
        self.as_u64().map(|v| v as i64)
    }

    pub fn as_bytes(&self) -> Option<&[u8]> {
        match self {
            Value::Bytes(v) => Some(v),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        self.as_bytes().and_then(|b| std::str::from_utf8(b).ok())
    }
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Message {
    fields: Vec<(u32, Value)>,
}

impl Message {
    pub fn decode(buf: &[u8]) -> Result<Self, ReplayError> {
        if buf.len() > MAX_MESSAGE_BYTES {
            return Err(ReplayError::InvalidResults(format!(
                "protobuf message {} bytes exceeds {MAX_MESSAGE_BYTES}",
                buf.len()
            )));
        }
        let mut fields = Vec::new();
        let mut cursor = 0usize;
        while cursor < buf.len() {
            if fields.len() >= MAX_VALUES {
                return Err(ReplayError::InvalidResults(format!(
                    "protobuf value count exceeds {MAX_VALUES}"
                )));
            }
            let key = read_varint(buf, &mut cursor)?;
            let field_number = (key >> 3) as u32;
            let wire_type = (key & 0x07) as u32;
            if field_number == 0 || field_number > MAX_FIELD_NUMBER {
                return Err(ReplayError::InvalidResults(format!(
                    "illegal protobuf field number {field_number}"
                )));
            }
            let value = match wire_type {
                WIRE_VARINT => Value::Varint(read_varint(buf, &mut cursor)?),
                WIRE_FIXED64 => {
                    let raw = read_exact(buf, &mut cursor, 8)?;
                    Value::Fixed64(u64::from_le_bytes(raw.try_into().expect("8 bytes")))
                }
                WIRE_FIXED32 => {
                    let raw = read_exact(buf, &mut cursor, 4)?;
                    Value::Fixed32(u32::from_le_bytes(raw.try_into().expect("4 bytes")))
                }
                WIRE_LEN => {
                    let len = read_varint(buf, &mut cursor)? as usize;
                    if len > MAX_MESSAGE_BYTES {
                        return Err(ReplayError::InvalidResults(format!(
                            "protobuf length-delimited field {len} bytes exceeds {MAX_MESSAGE_BYTES}"
                        )));
                    }
                    Value::Bytes(read_exact(buf, &mut cursor, len)?.to_vec())
                }
                other => {
                    return Err(ReplayError::InvalidResults(format!(
                        "unsupported protobuf wire type {other} for field {field_number}"
                    )))
                }
            };
            fields.push((field_number, value));
        }
        Ok(Self { fields })
    }

    pub fn first(&self, field: u32) -> Option<&Value> {
        self.fields
            .iter()
            .find(|(number, _)| *number == field)
            .map(|(_, value)| value)
    }

    pub fn varint(&self, field: u32) -> Option<u64> {
        self.first(field).and_then(Value::as_u64)
    }

    pub fn int(&self, field: u32) -> Option<i64> {
        self.first(field).and_then(Value::as_i64)
    }

    pub fn string(&self, field: u32) -> Option<&str> {
        self.first(field).and_then(Value::as_str)
    }

    /// Nested message by field number (first occurrence).
    pub fn message(&self, field: u32) -> Result<Option<Message>, ReplayError> {
        match self.first(field).and_then(Value::as_bytes) {
            Some(bytes) => Message::decode(bytes).map(Some),
            None => Ok(None),
        }
    }

    /// All occurrences of a repeated nested message field, in wire order.
    pub fn repeated(&self, field: u32) -> Result<Vec<Message>, ReplayError> {
        let mut out = Vec::new();
        for (number, value) in &self.fields {
            if *number == field {
                if let Some(bytes) = value.as_bytes() {
                    out.push(Message::decode(bytes)?);
                }
            }
        }
        Ok(out)
    }
}

fn read_varint(buf: &[u8], cursor: &mut usize) -> Result<u64, ReplayError> {
    let mut result = 0u64;
    let mut shift = 0u32;
    for _ in 0..MAX_VARINT_BYTES {
        let byte = *buf
            .get(*cursor)
            .ok_or_else(|| ReplayError::InvalidResults("truncated varint".to_string()))?;
        *cursor += 1;
        result |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 {
            return Ok(result);
        }
        shift += 7;
    }
    Err(ReplayError::InvalidResults(format!(
        "varint longer than {MAX_VARINT_BYTES} bytes"
    )))
}

fn read_exact<'b>(buf: &'b [u8], cursor: &mut usize, len: usize) -> Result<&'b [u8], ReplayError> {
    let end = cursor
        .checked_add(len)
        .ok_or_else(|| ReplayError::InvalidResults("field length overflow".to_string()))?;
    let slice = buf
        .get(*cursor..end)
        .ok_or_else(|| ReplayError::InvalidResults("truncated field".to_string()))?;
    *cursor = end;
    Ok(slice)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_varint_and_nested_message() {
        // field 3 varint 2, field 301 length-delimited {field 1 varint 7}
        let inner = [0x08, 0x07];
        let mut buf = vec![0x18, 0x02];
        buf.push(0xEA); // (301 << 3) | 2
        buf.push(0x12);
        buf.push(inner.len() as u8);
        buf.extend_from_slice(&inner);

        let message = Message::decode(&buf).expect("decodes");
        assert_eq!(message.varint(3), Some(2));
        let nested = message.message(301).expect("nested").expect("present");
        assert_eq!(nested.varint(1), Some(7));
    }

    #[test]
    fn negative_int32_round_trips() {
        // field 105 = -1 encoded as a 10-byte varint (two's complement).
        let mut buf = vec![0xC8, 0x06]; // (105 << 3) | 0
        buf.extend_from_slice(&[0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]);
        let message = Message::decode(&buf).expect("decodes");
        assert_eq!(message.int(105), Some(-1));
    }

    #[test]
    fn rejects_truncated_length_delimited_field() {
        let err = Message::decode(&[0xAA, 0x12, 0x05, 0x01]).unwrap_err();
        assert_eq!(err.code(), "INVALID_RESULTS");
    }
}
