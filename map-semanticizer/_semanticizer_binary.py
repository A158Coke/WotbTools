"""DVPL/LZ4 resource decoding and checked binary reader."""
from __future__ import annotations
import pathlib
import struct
import zlib
from dataclasses import dataclass
from typing import Any

DVPL_FOOTER = struct.Struct("<III4s4s")

class SemanticizerError(RuntimeError):
    """An actionable input or parsing error."""

def lz4_block_decompress(payload: bytes, expected_size: int) -> bytes:
    """Decode a raw LZ4 block using only the Python standard library."""
    source = memoryview(payload)
    output = bytearray()
    cursor = 0
    while cursor < len(source):
        token = source[cursor]
        cursor += 1

        literal_length = token >> 4
        if literal_length == 15:
            while True:
                if cursor >= len(source):
                    raise SemanticizerError("Invalid LZ4 literal length")
                value = source[cursor]
                cursor += 1
                literal_length += value
                if value != 255:
                    break

        literal_end = cursor + literal_length
        if literal_end > len(source):
            raise SemanticizerError("Invalid LZ4 literal range")
        output.extend(source[cursor:literal_end])
        cursor = literal_end
        if cursor == len(source):
            break

        if cursor + 2 > len(source):
            raise SemanticizerError("Missing LZ4 match offset")
        match_offset = int.from_bytes(source[cursor:cursor + 2], "little")
        cursor += 2
        if match_offset <= 0 or match_offset > len(output):
            raise SemanticizerError(f"Invalid LZ4 match offset {match_offset}")

        match_length = token & 0x0F
        if match_length == 15:
            while True:
                if cursor >= len(source):
                    raise SemanticizerError("Invalid LZ4 match length")
                value = source[cursor]
                cursor += 1
                match_length += value
                if value != 255:
                    break
        match_length += 4

        match_start = len(output) - match_offset
        for index in range(match_length):
            output.append(output[match_start + index])

    if len(output) != expected_size:
        raise SemanticizerError(
            f"LZ4 size mismatch: expected {expected_size}, decoded {len(output)}"
        )
    return bytes(output)

def decode_dvpl(raw: bytes) -> bytes:
    if len(raw) < DVPL_FOOTER.size:
        raise SemanticizerError("File is too small to contain a DVPL footer")
    unpacked_size, packed_size, expected_crc, compression_raw, magic = DVPL_FOOTER.unpack_from(
        raw, len(raw) - DVPL_FOOTER.size
    )
    if magic != b"DVPL":
        raise SemanticizerError("Missing DVPL footer")
    payload = raw[:-DVPL_FOOTER.size]
    if packed_size != len(payload):
        raise SemanticizerError(
            f"DVPL packed-size mismatch: footer={packed_size}, actual={len(payload)}"
        )
    actual_crc = zlib.crc32(payload) & 0xFFFFFFFF
    if actual_crc != expected_crc:
        raise SemanticizerError(
            f"DVPL CRC mismatch: expected={expected_crc:08x}, actual={actual_crc:08x}"
        )
    compression = compression_raw[0]
    if compression == 0:
        result = payload
    elif compression in (1, 2):
        result = lz4_block_decompress(payload, unpacked_size)
    else:
        raise SemanticizerError(f"Unsupported DVPL compression type {compression}")
    if len(result) != unpacked_size:
        raise SemanticizerError(
            f"DVPL unpacked-size mismatch: expected={unpacked_size}, actual={len(result)}"
        )
    return result

def read_resource(path: pathlib.Path) -> bytes:
    raw = path.read_bytes()
    return decode_dvpl(raw) if path.name.lower().endswith(".dvpl") else raw

@dataclass
class Reader:
    data: bytes
    offset: int = 0

    def take(self, size: int) -> bytes:
        end = self.offset + size
        if end > len(self.data):
            raise SemanticizerError(
                f"Unexpected end of file at 0x{self.offset:x}; need {size} bytes"
            )
        value = self.data[self.offset:end]
        self.offset = end
        return value

    def unpack(self, fmt: str) -> tuple[Any, ...]:
        parser = struct.Struct("<" + fmt)
        return parser.unpack(self.take(parser.size))

    def u8(self) -> int:
        return self.unpack("B")[0]

    def i8(self) -> int:
        return self.unpack("b")[0]

    def u16(self) -> int:
        return self.unpack("H")[0]

    def i16(self) -> int:
        return self.unpack("h")[0]

    def u32(self) -> int:
        return self.unpack("I")[0]

    def i32(self) -> int:
        return self.unpack("i")[0]

    def u64(self) -> int:
        return self.unpack("Q")[0]

    def i64(self) -> int:
        return self.unpack("q")[0]

    def f32(self) -> float:
        return self.unpack("f")[0]

    def f64(self) -> float:
        return self.unpack("d")[0]

    def text(self, size: int, encoding: str = "utf-8") -> str:
        return self.take(size).decode(encoding, errors="replace")
