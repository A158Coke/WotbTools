"""DAVA SceneFileV2 (.sc2) + DVPL reader — vendored parsing core.

Provenance: functions are lifted verbatim from the external `map-semanticizer`
tool (`map_semanticizer.py`, WotB_Map_Semanticizer_v1) that produced
`common/map-semantics/*.semantic.json`. Vendored here so map-fact extraction is
re-runnable from this repository alone when the game client updates.

Only the reader is vendored; no semantic analysis. Stdlib only.
"""

from __future__ import annotations

import pathlib
import struct
import zlib
from dataclasses import dataclass
from typing import Any


DVPL_FOOTER = struct.Struct("<III4s4s")


TYPE_NONE = 0


TYPE_BOOLEAN = 1


TYPE_INT32 = 2


TYPE_FLOAT = 3


TYPE_STRING = 4


TYPE_WIDE_STRING = 5


TYPE_BYTE_ARRAY = 6


TYPE_UINT32 = 7


TYPE_KEYED_ARCHIVE = 8


TYPE_INT64 = 9


TYPE_UINT64 = 10


TYPE_VECTOR2 = 11


TYPE_VECTOR3 = 12


TYPE_VECTOR4 = 13


TYPE_MATRIX2 = 14


TYPE_MATRIX3 = 15


TYPE_MATRIX4 = 16


TYPE_COLOR = 17


TYPE_FASTNAME = 18


TYPE_AABBOX3 = 19


TYPE_FILEPATH = 20


TYPE_FLOAT64 = 21


TYPE_INT8 = 22


TYPE_UINT8 = 23


TYPE_INT16 = 24


TYPE_UINT16 = 25


TYPE_ARRAY = 27


TYPE_TRANSFORM = 29


class Sc2ParseError(RuntimeError):
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
                    raise Sc2ParseError("Invalid LZ4 literal length")
                value = source[cursor]
                cursor += 1
                literal_length += value
                if value != 255:
                    break

        literal_end = cursor + literal_length
        if literal_end > len(source):
            raise Sc2ParseError("Invalid LZ4 literal range")
        output.extend(source[cursor:literal_end])
        cursor = literal_end
        if cursor == len(source):
            break

        if cursor + 2 > len(source):
            raise Sc2ParseError("Missing LZ4 match offset")
        match_offset = int.from_bytes(source[cursor:cursor + 2], "little")
        cursor += 2
        if match_offset <= 0 or match_offset > len(output):
            raise Sc2ParseError(f"Invalid LZ4 match offset {match_offset}")

        match_length = token & 0x0F
        if match_length == 15:
            while True:
                if cursor >= len(source):
                    raise Sc2ParseError("Invalid LZ4 match length")
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
        raise Sc2ParseError(
            f"LZ4 size mismatch: expected {expected_size}, decoded {len(output)}"
        )
    return bytes(output)


def decode_dvpl(raw: bytes) -> bytes:
    if len(raw) < DVPL_FOOTER.size:
        raise Sc2ParseError("File is too small to contain a DVPL footer")
    unpacked_size, packed_size, expected_crc, compression_raw, magic = DVPL_FOOTER.unpack_from(
        raw, len(raw) - DVPL_FOOTER.size
    )
    if magic != b"DVPL":
        raise Sc2ParseError("Missing DVPL footer")
    payload = raw[:-DVPL_FOOTER.size]
    if packed_size != len(payload):
        raise Sc2ParseError(
            f"DVPL packed-size mismatch: footer={packed_size}, actual={len(payload)}"
        )
    actual_crc = zlib.crc32(payload) & 0xFFFFFFFF
    if actual_crc != expected_crc:
        raise Sc2ParseError(
            f"DVPL CRC mismatch: expected={expected_crc:08x}, actual={actual_crc:08x}"
        )
    compression = compression_raw[0]
    if compression == 0:
        result = payload
    elif compression in (1, 2):
        result = lz4_block_decompress(payload, unpacked_size)
    else:
        raise Sc2ParseError(f"Unsupported DVPL compression type {compression}")
    if len(result) != unpacked_size:
        raise Sc2ParseError(
            f"DVPL unpacked-size mismatch: expected={unpacked_size}, actual={len(result)}"
        )
    return result


@dataclass
class Reader:
    data: bytes
    offset: int = 0

    def take(self, size: int) -> bytes:
        end = self.offset + size
        if end > len(self.data):
            raise Sc2ParseError(
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


def table_value(string_table: dict[int, str] | None, key: int) -> str:
    if string_table is None or key not in string_table:
        raise Sc2ParseError(f"Unknown fast-name id {key}")
    return string_table[key]


def read_ka_value(reader: Reader, value_type: int, string_table: dict[int, str] | None) -> Any:
    if value_type == TYPE_NONE:
        return None
    if value_type == TYPE_BOOLEAN:
        return bool(reader.u8())
    if value_type == TYPE_INT32:
        return reader.i32()
    if value_type == TYPE_FLOAT:
        return reader.f32()
    if value_type in (TYPE_STRING, TYPE_WIDE_STRING, TYPE_FASTNAME, TYPE_FILEPATH):
        if string_table is not None:
            return table_value(string_table, reader.u32())
        length = reader.u32()
        encoding = "utf-16-le" if value_type == TYPE_WIDE_STRING else "utf-8"
        byte_length = length * 2 if value_type == TYPE_WIDE_STRING else length
        return reader.text(byte_length, encoding)
    if value_type == TYPE_BYTE_ARRAY:
        return {"$bytes": reader.take(reader.u32()).hex()}
    if value_type == TYPE_UINT32:
        return reader.u32()
    if value_type == TYPE_KEYED_ARCHIVE:
        size = reader.u32()
        child = Reader(reader.take(size))
        archive = read_archive(child, string_table)
        if child.offset != len(child.data):
            raise Sc2ParseError("Nested KeyedArchive has trailing bytes")
        return archive
    if value_type == TYPE_INT64:
        return reader.i64()
    if value_type == TYPE_UINT64:
        return reader.u64()
    if value_type in (TYPE_VECTOR2, TYPE_VECTOR3, TYPE_VECTOR4):
        return [reader.f32() for _ in range(value_type - TYPE_VECTOR2 + 2)]
    if value_type in (TYPE_MATRIX2, TYPE_MATRIX3, TYPE_MATRIX4):
        side = value_type - TYPE_MATRIX2 + 2
        return [[reader.f32() for _ in range(side)] for _ in range(side)]
    if value_type == TYPE_COLOR:
        return [reader.f32() for _ in range(4)]
    if value_type == TYPE_AABBOX3:
        return {"min": [reader.f32() for _ in range(3)], "max": [reader.f32() for _ in range(3)]}
    if value_type == TYPE_FLOAT64:
        return reader.f64()
    if value_type == TYPE_INT8:
        return reader.i8()
    if value_type == TYPE_UINT8:
        return reader.u8()
    if value_type == TYPE_INT16:
        return reader.i16()
    if value_type == TYPE_UINT16:
        return reader.u16()
    if value_type == TYPE_ARRAY:
        return [read_ka_value(reader, reader.u8(), string_table) for _ in range(reader.u32())]
    if value_type == TYPE_TRANSFORM:
        return {
            "position": [reader.f32() for _ in range(3)],
            "scale": [reader.f32() for _ in range(3)],
            "quaternion": [reader.f32() for _ in range(4)],
        }
    raise Sc2ParseError(
        f"Unknown KeyedArchive value type {value_type} at 0x{reader.offset - 1:x}"
    )


def read_archive(reader: Reader, inherited_table: dict[int, str] | None = None) -> dict[str, Any]:
    start = reader.offset
    if reader.take(2) != b"KA":
        raise Sc2ParseError(f"Missing KeyedArchive magic at 0x{start:x}")
    version = reader.u16()
    if version == 0xFF02:
        return {}

    string_table = inherited_table
    if version == 1:
        result: dict[str, Any] = {}
        for _ in range(reader.u32()):
            key = read_ka_value(reader, reader.u8(), None)
            result[str(key)] = read_ka_value(reader, reader.u8(), None)
        return result
    if version == 2:
        string_count = reader.u32()
        strings = [reader.text(reader.u16()) for _ in range(string_count)]
        ids = [reader.u32() for _ in range(string_count)]
        string_table = dict(zip(ids, strings, strict=True))
    elif version != 0x0102:
        raise Sc2ParseError(f"Unsupported KeyedArchive version 0x{version:04x}")
    if string_table is None:
        raise Sc2ParseError("KeyedArchive has no inherited string table")

    result = {}
    for _ in range(reader.u32()):
        key = table_value(string_table, reader.u32())
        result[key] = read_ka_value(reader, reader.u8(), string_table)
    return result


def read_sc2(raw: bytes) -> dict[str, Any]:
    reader = Reader(raw)
    if reader.take(4) != b"SFV2":
        raise Sc2ParseError("Scene resource is not a SceneFileV2 (.sc2)")
    version = reader.u32()
    node_count = reader.u32()
    version_tags = read_archive(reader)
    descriptor_size = reader.u32()
    reader.take(descriptor_size)
    body = read_archive(reader)
    return {
        "$metadata": {
            "version": version,
            "declaredNodeCount": node_count,
            "versionTags": version_tags,
            "parsedBytes": reader.offset,
            "fileBytes": len(raw),
        },
        **body,
    }


def decode_bytes(value: Any) -> bytes | None:
    if isinstance(value, dict) and isinstance(value.get("$bytes"), str):
        return bytes.fromhex(value["$bytes"])
    return None


def entity_components(entity: dict[str, Any]) -> list[dict[str, Any]]:
    raw = entity.get("components", {})
    return [value for value in raw.values() if isinstance(value, dict)]


def entity_component(entity: dict[str, Any], type_name: str) -> dict[str, Any] | None:
    return next(
        (item for item in entity_components(entity) if item.get("comp.typename") == type_name),
        None,
    )


def entity_position(entity: dict[str, Any]) -> tuple[float, float, float] | None:
    transform = entity_component(entity, "TransformComponent")
    if transform is None:
        return None
    value = transform.get("tc.worldTranslation")
    if not isinstance(value, list) or len(value) != 3:
        return None
    return float(value[0]), float(value[1]), float(value[2])


def entity_labels(entity: dict[str, Any]) -> list[str]:
    label_component = entity_component(entity, "LabelComponent")
    if label_component is None:
        return []
    value = label_component.get("lc.labels", [])
    return [str(label) for label in value] if isinstance(value, list) else []


def entity_properties(entity: dict[str, Any]) -> dict[str, Any]:
    custom = entity_component(entity, "CustomPropertiesComponent")
    if custom is None:
        return {}
    value = custom.get("cpc.properties.archive", {})
    return value if isinstance(value, dict) else {}


def scene_entities(scene: dict[str, Any]) -> list[dict[str, Any]]:
    hierarchy = scene.get("#hierarchy", [])
    if not isinstance(hierarchy, list):
        raise Sc2ParseError("SC2 #hierarchy is not an array")
    return [entity for entity in hierarchy if isinstance(entity, dict)]
