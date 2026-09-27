//! `data.wotreplay` packet-stream framing (M6 WP6.1).
//!
//! Authority: `docs/reference/replay-data.md` (header + packet layout). Semantic port source is the
//! Java plane: `com.wotb.core.parse.ReplayStreamHeader` (header) and
//! `com.wotb.core.replay.stream.ReplayPacketStreamReader` (framing + diagnostics).
//!
//! Contract locked here:
//!
//! * header = magic `0x12345678` (u32 LE) + 8 unknown bytes + `len:u8`+UTF-8 hash + `len:u8`+UTF-8
//!   client version + 1 padding byte; [`ReplayStreamHeader::packet_stream_offset`] is the total
//!   header length;
//! * every packet frame is `payloadLen:u32 LE` + `type:u32 LE` + `clock:f32 LE (raw u32 bits)` +
//!   `payloadLen` payload bytes;
//! * **strict contiguous framing**: frames are contiguous, `payloadLen == 0` is legal, the stream
//!   ends at the terminator (`type == 0xFFFF_FFFF`) and *nothing* may follow it. Any violation
//!   fails the whole stream — there is never a byte-wise resync (that would silently reinterpret
//!   garbage as packets);
//! * the raw clock is never rewritten; regression is only *counted* as a diagnostic;
//! * packet payloads are borrowed from the caller's bytes (no per-packet copy, see plan R3).

use std::collections::BTreeMap;

use crate::error::ReplayError;

/// Header magic of every `data.wotreplay` stream.
pub const EXPECTED_MAGIC: u32 = 0x1234_5678;
/// Largest legal single-payload length (Java `MAX_PAYLOAD_LEN`).
pub const MAX_PAYLOAD_LEN: u32 = 200_000;
/// Largest clock value treated as sane; anything above is a framing corruption (Java `MAX_SANE_CLOCK`).
pub const MAX_SANE_CLOCK_SEC: f32 = 5000.0;
/// Hard packet ceiling per replay (Java `MAX_PACKETS`).
pub const MAX_PACKETS: usize = 200_000;
/// Current-version stream terminator (proven: `payloadLen=16`, `rawClock=0`).
pub const TERMINATOR_TYPE: u32 = 0xFFFF_FFFF;

/// Frame header size: `payloadLen` + `type` + `clock`.
pub const FRAME_HEADER_LEN: usize = 12;

// Stable stream error tokens. Java reports the first five as exception prose and the last five as
// coded `IllegalArgumentException` messages; the engine keeps every failure machine-readable.
pub const ERR_HEADER_TOO_SHORT: &str = "REPLAY_STREAM_TOO_SHORT";
pub const ERR_BAD_MAGIC: &str = "REPLAY_BAD_MAGIC";
pub const ERR_INVALID_CLIENT_HASH_LEN: &str = "REPLAY_INVALID_CLIENT_HASH_LEN";
pub const ERR_INVALID_CLIENT_VERSION_LEN: &str = "REPLAY_INVALID_CLIENT_VERSION_LEN";
pub const ERR_PACKET_LIMIT_EXCEEDED: &str = "REPLAY_PACKET_LIMIT_EXCEEDED";
pub const ERR_INVALID_PAYLOAD_LEN: &str = "REPLAY_INVALID_PAYLOAD_LEN";
pub const ERR_TRUNCATED_PACKET: &str = "REPLAY_TRUNCATED_PACKET";
pub const ERR_INVALID_CLOCK: &str = "REPLAY_INVALID_CLOCK";
pub const ERR_TRAILING_DATA: &str = "REPLAY_TRAILING_DATA";

fn stream_error(code: &str, detail: impl std::fmt::Display) -> ReplayError {
    ReplayError::CorruptedStream(format!("{code}: {detail}"))
}

/// Parsed `data.wotreplay` header.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplayStreamHeader {
    /// Always [`EXPECTED_MAGIC`] once parsing succeeded (kept for parity/debugging).
    pub magic: u32,
    /// The 8 bytes between magic and the hash — reserved/unknown, preserved verbatim.
    pub unknown_header_bytes: [u8; 8],
    pub client_hash: String,
    pub client_version: String,
    /// Offset of the first packet frame (== total header length).
    pub packet_stream_offset: usize,
}

impl ReplayStreamHeader {
    /// Parse the stream header. Rejects anything that is not a well-formed header.
    pub fn parse(data: &[u8]) -> Result<Self, ReplayError> {
        if data.len() < 15 {
            return Err(stream_error(
                ERR_HEADER_TOO_SHORT,
                format!("{} bytes", data.len()),
            ));
        }

        let mut offset = 0usize;

        let magic = read_u32_le(data, offset);
        offset += 4;
        if magic != EXPECTED_MAGIC {
            return Err(stream_error(
                ERR_BAD_MAGIC,
                format!("expected 0x{EXPECTED_MAGIC:08x} but got 0x{magic:08x}"),
            ));
        }

        if data.len() < offset + 8 {
            return Err(stream_error(ERR_HEADER_TOO_SHORT, "unknown header bytes"));
        }
        let mut unknown_header_bytes = [0u8; 8];
        unknown_header_bytes.copy_from_slice(&data[offset..offset + 8]);
        offset += 8;

        let (client_hash, next) =
            read_len_prefixed_text(data, offset, ERR_INVALID_CLIENT_HASH_LEN)?;
        offset = next;
        let (client_version, next) =
            read_len_prefixed_text(data, offset, ERR_INVALID_CLIENT_VERSION_LEN)?;
        offset = next;

        if offset >= data.len() {
            return Err(stream_error(ERR_HEADER_TOO_SHORT, "header padding byte"));
        }
        offset += 1;

        Ok(ReplayStreamHeader {
            magic,
            unknown_header_bytes,
            client_hash,
            client_version,
            packet_stream_offset: offset,
        })
    }
}

/// One raw packet frame. Holds offsets into the caller's bytes instead of a payload copy.
#[derive(Debug, Clone, PartialEq)]
pub struct Packet {
    /// Stable position in the stream, starting at 0.
    pub sequence: u32,
    /// Byte offset of the frame header.
    pub source_offset: usize,
    pub payload_len: u32,
    /// Unsigned packet type (Java stores this in a signed `int`; `0xFFFF_FFFF` is the terminator).
    pub packet_type: u32,
    /// Raw file clock, never rewritten.
    pub raw_clock_sec: f32,
    /// Byte offset of the payload inside the source bytes.
    pub payload_offset: usize,
}

impl Packet {
    /// Borrow this packet's payload from the same source bytes it was framed from.
    pub fn payload<'a>(&self, source: &'a [u8]) -> &'a [u8] {
        &source[self.payload_offset..self.payload_offset + self.payload_len as usize]
    }
}

/// Per-type aggregation used by the diagnostics block (Java `PacketTypeStats`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PacketTypeStats {
    pub count: u32,
    pub first_clock_sec: f32,
    pub max_observed_raw_clock_sec: f32,
}

/// Framing diagnostics. `types` is ordered by packet type so the value is deterministic.
#[derive(Debug, Clone, PartialEq)]
pub struct StreamDiagnostics {
    pub source_size: usize,
    pub packet_count: usize,
    pub first_clock_sec: f32,
    pub max_observed_raw_clock_sec: f32,
    /// How often the raw clock went backwards. Reported, never "fixed".
    pub clock_regression_count: u32,
    pub types: BTreeMap<u32, PacketTypeStats>,
}

/// Header + every framed packet + diagnostics.
#[derive(Debug, Clone)]
pub struct PacketStream {
    pub header: ReplayStreamHeader,
    pub packets: Vec<Packet>,
    pub diagnostics: StreamDiagnostics,
}

impl PacketStream {
    /// Parse the header and scan the whole stream.
    pub fn open(data: &[u8]) -> Result<Self, ReplayError> {
        let header = ReplayStreamHeader::parse(data)?;
        Self::scan(data, header)
    }

    /// Scan with an already-parsed header (so a caller that parsed it once does not parse twice).
    pub fn scan(data: &[u8], header: ReplayStreamHeader) -> Result<Self, ReplayError> {
        let source_size = data.len();
        let mut offset = header.packet_stream_offset;

        let mut packets: Vec<Packet> = Vec::new();
        let mut types: BTreeMap<u32, PacketTypeStats> = BTreeMap::new();

        let mut first_clock_sec = f32::NAN;
        let mut max_observed_raw_clock_sec = f32::NAN;
        let mut previous_clock_sec = f32::NAN;
        let mut clock_regression_count: u32 = 0;

        while offset + FRAME_HEADER_LEN <= source_size {
            if packets.len() >= MAX_PACKETS {
                return Err(stream_error(
                    ERR_PACKET_LIMIT_EXCEEDED,
                    format!("at offset {offset}"),
                ));
            }

            let payload_len = read_u32_le(data, offset);

            // `payload_len == 0` is legal; anything above the cap (including a "negative" u32) fails.
            if payload_len > MAX_PAYLOAD_LEN {
                return Err(stream_error(
                    ERR_INVALID_PAYLOAD_LEN,
                    format!("at offset {offset}"),
                ));
            }

            if offset + FRAME_HEADER_LEN + payload_len as usize > source_size {
                return Err(stream_error(
                    ERR_TRUNCATED_PACKET,
                    format!("at offset {offset}"),
                ));
            }

            let packet_type = read_u32_le(data, offset + 4);
            let clock_secs = f32::from_bits(read_u32_le(data, offset + 8));

            // Strict framing never skips on a suspicious clock — it fails.
            if clock_secs.is_nan() || clock_secs < 0.0 || clock_secs > MAX_SANE_CLOCK_SEC {
                return Err(stream_error(
                    ERR_INVALID_CLOCK,
                    format!("at offset {offset}"),
                ));
            }

            let sequence = packets.len() as u32;
            packets.push(Packet {
                sequence,
                source_offset: offset,
                payload_len,
                packet_type,
                raw_clock_sec: clock_secs,
                payload_offset: offset + FRAME_HEADER_LEN,
            });

            let stats = types.entry(packet_type).or_insert(PacketTypeStats {
                count: 0,
                first_clock_sec: f32::NAN,
                max_observed_raw_clock_sec: f32::NAN,
            });
            stats.count += 1;
            if stats.first_clock_sec.is_nan() || clock_secs < stats.first_clock_sec {
                stats.first_clock_sec = clock_secs;
            }
            if stats.max_observed_raw_clock_sec.is_nan()
                || clock_secs > stats.max_observed_raw_clock_sec
            {
                stats.max_observed_raw_clock_sec = clock_secs;
            }

            if first_clock_sec.is_nan() || clock_secs < first_clock_sec {
                first_clock_sec = clock_secs;
            }
            // Ported verbatim from the Java reader, including its regression counting branches.
            if max_observed_raw_clock_sec.is_nan() || clock_secs >= max_observed_raw_clock_sec {
                if !max_observed_raw_clock_sec.is_nan() && clock_secs < previous_clock_sec {
                    clock_regression_count += 1;
                }
                max_observed_raw_clock_sec = clock_secs;
            } else if clock_secs < previous_clock_sec {
                clock_regression_count += 1;
            }
            previous_clock_sec = clock_secs;

            offset += FRAME_HEADER_LEN + payload_len as usize;
            if packet_type == TERMINATOR_TYPE {
                // Nothing after the terminator may be reinterpreted as data.
                break;
            }
        }

        if offset < source_size {
            return Err(stream_error(
                ERR_TRAILING_DATA,
                format!("after terminator at offset {offset}"),
            ));
        }

        let packet_count = packets.len();

        Ok(PacketStream {
            header,
            packets,
            diagnostics: StreamDiagnostics {
                source_size,
                packet_count,
                first_clock_sec: if first_clock_sec.is_nan() {
                    0.0
                } else {
                    first_clock_sec
                },
                max_observed_raw_clock_sec: if max_observed_raw_clock_sec.is_nan() {
                    0.0
                } else {
                    max_observed_raw_clock_sec
                },
                clock_regression_count,
                types,
            },
        })
    }
}

fn read_len_prefixed_text(
    data: &[u8],
    offset: usize,
    invalid_len_code: &str,
) -> Result<(String, usize), ReplayError> {
    if offset >= data.len() {
        return Err(stream_error(ERR_HEADER_TOO_SHORT, "length byte"));
    }
    let len = data[offset] as usize;
    let start = offset + 1;
    if start + len > data.len() {
        return Err(stream_error(
            invalid_len_code,
            format!("length {len} at offset {offset}"),
        ));
    }
    let text = String::from_utf8_lossy(&data[start..start + len]).into_owned();
    Ok((text, start + len))
}

fn read_u32_le(buf: &[u8], index: usize) -> u32 {
    u32::from_le_bytes([buf[index], buf[index + 1], buf[index + 2], buf[index + 3]])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn header_bytes(hash: &str, version: &str) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&EXPECTED_MAGIC.to_le_bytes());
        out.extend_from_slice(&[0u8; 8]);
        out.push(hash.len() as u8);
        out.extend_from_slice(hash.as_bytes());
        out.push(version.len() as u8);
        out.extend_from_slice(version.as_bytes());
        out.push(0u8);
        out
    }

    fn frame(payload: &[u8], packet_type: u32, clock: f32) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        out.extend_from_slice(&packet_type.to_le_bytes());
        out.extend_from_slice(&clock.to_bits().to_le_bytes());
        out.extend_from_slice(payload);
        out
    }

    fn stream(frames: Vec<Vec<u8>>) -> Vec<u8> {
        let mut out = header_bytes("hash", "11.18.0_china_apple");
        for f in frames {
            out.extend_from_slice(&f);
        }
        out
    }

    /// The terminator participates in the clock bookkeeping exactly like any other frame (Java
    /// counts its clock too), so tests state its clock explicitly instead of relying on 0.
    fn terminator_at(clock: f32) -> Vec<u8> {
        frame(&[0u8; 16], TERMINATOR_TYPE, clock)
    }

    #[test]
    fn parses_header_and_reports_stream_offset() {
        let data = header_bytes("abc", "11.19.0_china");
        let header = ReplayStreamHeader::parse(&data).expect("header");
        assert_eq!(header.magic, EXPECTED_MAGIC);
        assert_eq!(header.client_hash, "abc");
        assert_eq!(header.client_version, "11.19.0_china");
        assert_eq!(header.unknown_header_bytes, [0u8; 8]);
        // 4 magic + 8 unknown + 1 len + 3 hash + 1 len + 13 version + 1 padding
        assert_eq!(header.packet_stream_offset, 31);
    }

    #[test]
    fn rejects_bad_magic_and_short_header() {
        let mut bad = header_bytes("abc", "11.19.0_china");
        bad[0] = 0;
        let err = ReplayStreamHeader::parse(&bad).expect_err("bad magic");
        assert!(err.to_string().contains(ERR_BAD_MAGIC), "{err}");

        let err = ReplayStreamHeader::parse(&[0u8; 14]).expect_err("too short");
        assert!(err.to_string().contains(ERR_HEADER_TOO_SHORT), "{err}");
    }

    #[test]
    fn frames_packets_contiguously_and_stops_at_terminator() {
        let data = stream(vec![
            frame(&[1, 2, 3], 10, 0.5),
            frame(&[], 23, 1.25), // zero-length payload is legal
            terminator_at(1.25),
        ]);
        let parsed = PacketStream::open(&data).expect("stream");
        assert_eq!(parsed.packets.len(), 3);
        assert_eq!(parsed.packets[0].sequence, 0);
        assert_eq!(parsed.packets[0].packet_type, 10);
        assert_eq!(parsed.packets[0].raw_clock_sec, 0.5);
        assert_eq!(parsed.packets[0].payload(&data), &[1, 2, 3]);
        assert_eq!(parsed.packets[1].payload_len, 0);
        assert!(parsed.packets[1].payload(&data).is_empty());
        assert_eq!(parsed.packets[2].packet_type, TERMINATOR_TYPE);

        let diag = &parsed.diagnostics;
        assert_eq!(diag.packet_count, 3);
        assert_eq!(diag.source_size, data.len());
        assert_eq!(diag.first_clock_sec, 0.5);
        assert_eq!(diag.max_observed_raw_clock_sec, 1.25);
        assert_eq!(diag.clock_regression_count, 0);
        assert_eq!(diag.types[&10].count, 1);
        assert_eq!(diag.types[&TERMINATOR_TYPE].count, 1);
    }

    #[test]
    fn counts_clock_regressions_without_rewriting_the_clock() {
        let data = stream(vec![
            frame(&[0], 1, 1.0),
            frame(&[0], 1, 3.0),
            frame(&[0], 1, 2.0),
            terminator_at(2.0),
        ]);
        let parsed = PacketStream::open(&data).expect("stream");
        assert_eq!(parsed.diagnostics.clock_regression_count, 1);
        assert_eq!(parsed.packets[2].raw_clock_sec, 2.0);
        assert_eq!(parsed.diagnostics.types[&1].max_observed_raw_clock_sec, 3.0);
    }

    #[test]
    fn terminator_clock_participates_in_regression_counting() {
        // A terminator whose clock is lower than the last payload clock is a regression, exactly as
        // in the Java reader. Locked by a test so the port cannot silently "improve" it.
        let data = stream(vec![frame(&[0], 1, 4.0), terminator_at(0.0)]);
        let parsed = PacketStream::open(&data).expect("stream");
        assert_eq!(parsed.diagnostics.clock_regression_count, 1);
        assert_eq!(parsed.diagnostics.first_clock_sec, 0.0);
        assert_eq!(parsed.diagnostics.max_observed_raw_clock_sec, 4.0);
    }

    #[test]
    fn rejects_invalid_payload_len_truncated_packet_and_trailing_data() {
        // Declared length above the cap: the length check runs before any payload access.
        let mut too_long = header_bytes("hash", "11.19.0_china_apple");
        too_long.extend_from_slice(&(MAX_PAYLOAD_LEN + 1).to_le_bytes());
        too_long.extend_from_slice(&1u32.to_le_bytes());
        too_long.extend_from_slice(&0.0f32.to_bits().to_le_bytes());
        let err = PacketStream::open(&too_long).expect_err("payload len");
        assert!(err.to_string().contains(ERR_INVALID_PAYLOAD_LEN), "{err}");

        let mut truncated = stream(vec![frame(&[1, 2, 3], 1, 0.0)]);
        truncated.pop();
        let err = PacketStream::open(&truncated).expect_err("truncated");
        assert!(err.to_string().contains(ERR_TRUNCATED_PACKET), "{err}");

        let mut trailing = stream(vec![terminator_at(0.0)]);
        trailing.push(0);
        let err = PacketStream::open(&trailing).expect_err("trailing");
        assert!(err.to_string().contains(ERR_TRAILING_DATA), "{err}");

        // A partial frame header after the last complete packet is trailing corruption too.
        let mut partial = stream(vec![frame(&[1], 1, 0.0)]);
        partial.extend_from_slice(&[0, 0, 0]);
        let err = PacketStream::open(&partial).expect_err("partial header");
        assert!(err.to_string().contains(ERR_TRAILING_DATA), "{err}");
    }

    #[test]
    fn rejects_insane_clocks() {
        for clock in [f32::NAN, -1.0, MAX_SANE_CLOCK_SEC + 1.0] {
            let data = stream(vec![frame(&[0], 1, clock)]);
            let err = PacketStream::open(&data).expect_err("clock");
            assert!(
                err.to_string().contains(ERR_INVALID_CLOCK),
                "{clock}: {err}"
            );
        }
    }

    #[test]
    fn rejects_more_than_the_packet_ceiling() {
        let mut frames = Vec::with_capacity(MAX_PACKETS + 2);
        for _ in 0..=MAX_PACKETS {
            frames.push(frame(&[], 1, 0.0));
        }
        frames.push(terminator_at(0.0));
        let data = stream(frames);
        let err = PacketStream::open(&data).expect_err("packet limit");
        assert!(err.to_string().contains(ERR_PACKET_LIMIT_EXCEEDED), "{err}");
    }
}
