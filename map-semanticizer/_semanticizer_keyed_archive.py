"""DAVA KeyedArchive and SceneFileV2 schema decoding."""
from __future__ import annotations
from typing import Any
from _semanticizer_binary import Reader, SemanticizerError

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


def table_value(string_table: dict[int, str] | None, key: int) -> str:
    if string_table is None or key not in string_table:
        raise SemanticizerError(f"Unknown fast-name id {key}")
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
            raise SemanticizerError("Nested KeyedArchive has trailing bytes")
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
    raise SemanticizerError(
        f"Unknown KeyedArchive value type {value_type} at 0x{reader.offset - 1:x}"
    )


def read_archive(reader: Reader, inherited_table: dict[int, str] | None = None) -> dict[str, Any]:
    start = reader.offset
    if reader.take(2) != b"KA":
        raise SemanticizerError(f"Missing KeyedArchive magic at 0x{start:x}")
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
        raise SemanticizerError(f"Unsupported KeyedArchive version 0x{version:04x}")
    if string_table is None:
        raise SemanticizerError("KeyedArchive has no inherited string table")

    result = {}
    for _ in range(reader.u32()):
        key = table_value(string_table, reader.u32())
        result[key] = read_ka_value(reader, reader.u8(), string_table)
    return result


def read_sc2(raw: bytes) -> dict[str, Any]:
    reader = Reader(raw)
    if reader.take(4) != b"SFV2":
        raise SemanticizerError("Scene resource is not a SceneFileV2 (.sc2)")
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
