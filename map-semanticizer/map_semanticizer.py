#!/usr/bin/env python3
"""Generate evidence-backed WoT Blitz map semantics from DAVA client resources.

The script is intentionally deterministic. It reads the scene and heightmap,
builds auditable regions, and emits both JSON and compact Chinese text for an
LLM. It never calls an LLM and does not invent tactical routes.

Supported input:
  * one unpacked map directory;
  * one map directory whose resources still end in .dvpl;
  * a ZIP containing one map directory.

No third-party Python package is required.
"""

from __future__ import annotations

import argparse
import json
import math
import pathlib
import statistics
import struct
import sys
import tempfile
import zipfile
import zlib
from array import array
from collections import Counter, defaultdict, deque
from dataclasses import dataclass
from typing import Any, Sequence


SCHEMA_VERSION = 1
DVPL_FOOTER = struct.Struct("<III4s4s")

# Backend nine-grid convention (keep in sync with
# java/wotb-core/.../replay/feature/MapRegionResolver.java +
# MapCoordinateProfile.DEFAULT): replay raw coords ±250 m map linearly to a
# 500×500 canonical space split into 3×3 regions; row 1|2|3 = north/top,
# 7|8|9 = south/bottom, columns run west → east. The semanticizer y axis is
# north-positive and x is east-positive, matching replay (x, z).
NINE_GRID_HALF_EXTENT = 250.0
NINE_GRID_SIZE = 500.0


class SemanticizerError(RuntimeError):
    """An actionable input or parsing error."""


# ---------------------------------------------------------------------------
# DVPL
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# DAVA KeyedArchive / SceneFileV2
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Scene facts
# ---------------------------------------------------------------------------


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
        raise SemanticizerError("SC2 #hierarchy is not an array")
    return [entity for entity in hierarchy if isinstance(entity, dict)]


def world_bounds(entities: Sequence[dict[str, Any]]) -> tuple[float, float, float, float, float, float]:
    for entity in entities:
        if entity.get("name") != "Landscape":
            continue
        render = entity_component(entity, "RenderComponent")
        render_object = render.get("rc.renderObj", {}) if render else {}
        bbox = decode_bytes(render_object.get("bbox")) if isinstance(render_object, dict) else None
        if bbox is not None and len(bbox) == 24:
            return struct.unpack("<6f", bbox)
    raise SemanticizerError("Landscape world bounds are missing from SC2")


def matches_variant(labels: Sequence[str], variant: str | None) -> bool:
    """Variant filter: labeled points must carry the active variant; unlabeled
    scene data (night/reskin maps such as faust_night) is still exact scene data."""
    if variant is None:
        return not labels
    return variant in labels


def map_border(
    entities: Sequence[dict[str, Any]], variant: str | None
) -> tuple[float, float, float, float] | None:
    for entity in entities:
        if not matches_variant(entity_labels(entity), variant):
            continue
        border = entity_component(entity, "MapBorderComponent")
        rect = decode_bytes(border.get("mbc.rect")) if border else None
        if rect is not None and len(rect) == 16:
            return struct.unpack("<4f", rect)
    return None


def battle_points(entities: Sequence[dict[str, Any]], variant: str | None) -> list[dict[str, Any]]:
    result = []
    for entity in entities:
        labels = entity_labels(entity)
        if not matches_variant(labels, variant):
            continue
        props = entity_properties(entity)
        point_type = props.get("type")
        point_position = entity_position(entity)
        if point_type not in ("spawnpoint", "controlpoint", "strategicpoint", "botspawn"):
            continue
        if point_position is None:
            continue
        result.append(
            {
                "name": str(entity.get("name", "unnamed")),
                "type": str(point_type),
                "position": [round(value, 4) for value in point_position],
                "team": props.get("team"),
                "pointNumber": props.get("pointNumber"),
                "preferredVehicleType": props.get("SpawnPreferredVehicleType"),
                "confidence": "EXACT_SCENE_DATA",
            }
        )
    return result


def detect_variant(entities: Sequence[dict[str, Any]]) -> str | None:
    """Pick the variant label with the most battle points (the standard layout
    usually carries the full 32-point set; secondary modes carry fewer)."""
    counter: Counter[str] = Counter()
    for entity in entities:
        props = entity_properties(entity)
        if props.get("type") in ("spawnpoint", "controlpoint", "strategicpoint", "botspawn"):
            counter.update(entity_labels(entity))
    if not counter:
        return None
    return counter.most_common(1)[0][0]


# Client folder names that differ from the internal meta.json mapName.
# Identity mapping only; keeps batch --map-names-file reproducible.
MAP_ID_CODE_ALIASES: dict[str, tuple[str, ...]] = {
    "24_milibase_mlb": ("milbase",),
}


def derive_map_codes(map_id: str, known_codes: Sequence[str]) -> list[str]:
    """Match internal codes (map_names.json keys) to a client map id at token
    boundaries: single-token codes must appear as a token; multi-token codes
    must appear as a contiguous token subsequence."""
    tokens = map_id.split("_")
    result = set(MAP_ID_CODE_ALIASES.get(map_id, ()))
    for code in known_codes:
        code = code.strip().lower()
        if not code:
            continue
        code_tokens = code.split("_")
        if len(code_tokens) == 1:
            if code in tokens:
                result.add(code)
            continue
        for start in range(len(tokens) - len(code_tokens) + 1):
            if tokens[start:start + len(code_tokens)] == code_tokens:
                result.add(code)
                break
    return sorted(result)


def classify_feature(name: str) -> str | None:
    value = name.lower().replace("\\", "/")
    if value.startswith("snd_") or "_fx" in value or "dust" in value:
        return None
    # The order matters: some tent assets contain the word "house".
    if any(token in value for token in ("tent", "beduin")):
        return "soft_cover"
    if any(token in value for token in ("bridge", "estacade", "viaduct")):
        return "bridge"
    if any(token in value for token in ("rails", "railroad", "locomotive", "carriage", "train")):
        return "railway"
    if any(token in value for token in ("bld_", "building", "house", "mosque", "bazaar", "hangar")):
        return "building"
    if any(token in value for token in ("wall", "fence", "fortification")):
        return "wall"
    if any(token in value for token in ("ruin", "blocking_volume", "block", "barrier", "rock")):
        return "obstacle"
    if any(token in value for token in ("bush", "palm", "tree", "grass", "shrub")):
        return "vegetation"
    return None


def scene_features(
    entities: Sequence[dict[str, Any]],
    bounds: tuple[float, float, float, float, float, float],
) -> list[dict[str, Any]]:
    result = []
    for entity in entities:
        name = str(entity.get("name", ""))
        category = classify_feature(name)
        point = entity_position(entity)
        if category is None or point is None:
            continue
        x, y, z = point
        if not (bounds[0] <= x <= bounds[3] and bounds[1] <= y <= bounds[4]):
            continue
        result.append(
            {
                "name": name,
                "category": category,
                "position": [round(x, 4), round(y, 4), round(z, 4)],
                "confidence": "NAME_HEURISTIC_WITH_EXACT_POSITION",
            }
        )
    return result


# ---------------------------------------------------------------------------
# Terrain and grid
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Terrain:
    size: int
    tile_size: int
    heights: list[float]
    slopes: list[float]
    x_spacing: float
    y_spacing: float


def load_heightmap(
    raw: bytes, bounds: tuple[float, float, float, float, float, float]
) -> Terrain:
    if len(raw) < 8:
        raise SemanticizerError("Heightmap is too small")
    size, tile_size = struct.unpack_from("<II", raw)
    if tile_size <= 0 or size <= 0 or size % tile_size:
        raise SemanticizerError(f"Unexpected heightmap header: size={size}, tile={tile_size}")
    if len(raw) != 8 + size * size * 2:
        raise SemanticizerError(
            f"Unexpected heightmap size: header={size}x{size}, bytes={len(raw)}"
        )
    values = array("H")
    values.frombytes(raw[8:])
    if sys.byteorder != "little":
        values.byteswap()

    block_count = size // tile_size
    untiled = [0] * (size * size)
    source_index = 0
    for block_y in range(block_count):
        for block_x in range(block_count):
            for local_y in range(tile_size):
                destination = (block_y * tile_size + local_y) * size + block_x * tile_size
                untiled[destination:destination + tile_size] = values[
                    source_index:source_index + tile_size
                ]
                source_index += tile_size

    z_min, z_max = bounds[2], bounds[5]
    z_scale = (z_max - z_min) / 65535.0
    heights = [z_min + value * z_scale for value in untiled]
    x_spacing = (bounds[3] - bounds[0]) / size
    y_spacing = (bounds[4] - bounds[1]) / size
    slopes = [0.0] * (size * size)
    for y in range(size):
        y0, y1 = max(0, y - 1), min(size - 1, y + 1)
        dy_distance = max(y_spacing, (y1 - y0) * y_spacing)
        row = y * size
        for x in range(size):
            x0, x1 = max(0, x - 1), min(size - 1, x + 1)
            dx_distance = max(x_spacing, (x1 - x0) * x_spacing)
            dzdx = (heights[row + x1] - heights[row + x0]) / dx_distance
            dzdy = (heights[y1 * size + x] - heights[y0 * size + x]) / dy_distance
            slopes[row + x] = math.degrees(math.atan(math.hypot(dzdx, dzdy)))
    return Terrain(size, tile_size, heights, slopes, x_spacing, y_spacing)


def percentile(values: Sequence[float], fraction: float) -> float:
    if not values:
        raise SemanticizerError("Cannot calculate a percentile of an empty sequence")
    ordered = sorted(values)
    index = fraction * (len(ordered) - 1)
    lower = math.floor(index)
    upper = math.ceil(index)
    if lower == upper:
        return float(ordered[lower])
    weight = index - lower
    return float(ordered[lower] * (1.0 - weight) + ordered[upper] * weight)


def raster_window(
    rect: tuple[float, float, float, float],
    bounds: tuple[float, float, float, float, float, float],
    size: int,
) -> tuple[int, int, int, int]:
    x_min, x_max = sorted((rect[0], rect[2]))
    y_min, y_max = sorted((rect[1], rect[3]))
    ix0 = max(0, min(size - 1, int((x_min - bounds[0]) / (bounds[3] - bounds[0]) * size)))
    ix1 = max(ix0 + 1, min(size, math.ceil((x_max - bounds[0]) / (bounds[3] - bounds[0]) * size)))
    iy0 = max(0, min(size - 1, int((y_min - bounds[1]) / (bounds[4] - bounds[1]) * size)))
    iy1 = max(iy0 + 1, min(size, math.ceil((y_max - bounds[1]) / (bounds[4] - bounds[1]) * size)))
    return ix0, iy0, ix1, iy1


def window_values(data: Sequence[float], size: int, window: tuple[int, int, int, int]) -> list[float]:
    x0, y0, x1, y1 = window
    return [data[y * size + x] for y in range(y0, y1) for x in range(x0, x1)]


def sample_height(
    terrain: Terrain,
    bounds: tuple[float, float, float, float, float, float],
    x: float,
    y: float,
) -> float:
    # DAVA maps world positions to sample coordinates with x / size and y / size.
    sx = (x - bounds[0]) / (bounds[3] - bounds[0]) * terrain.size
    sy = (y - bounds[1]) / (bounds[4] - bounds[1]) * terrain.size
    sx = max(0.0, min(terrain.size - 1.0, sx))
    sy = max(0.0, min(terrain.size - 1.0, sy))
    x0, y0 = int(math.floor(sx)), int(math.floor(sy))
    x1, y1 = min(terrain.size - 1, x0 + 1), min(terrain.size - 1, y0 + 1)
    tx, ty = sx - x0, sy - y0
    h00 = terrain.heights[y0 * terrain.size + x0]
    h10 = terrain.heights[y0 * terrain.size + x1]
    h01 = terrain.heights[y1 * terrain.size + x0]
    h11 = terrain.heights[y1 * terrain.size + x1]
    return (
        h00 * (1 - tx) * (1 - ty)
        + h10 * tx * (1 - ty)
        + h01 * (1 - tx) * ty
        + h11 * tx * ty
    )


def cell_id(row_from_south: int, column: int, grid_size: int) -> str:
    return f"{chr(ord('A') + grid_size - row_from_south - 1)}{column + 1}"


def build_cells(
    terrain: Terrain,
    bounds: tuple[float, float, float, float, float, float],
    playable: tuple[float, float, float, float],
    features: Sequence[dict[str, Any]],
    grid_size: int,
) -> list[dict[str, Any]]:
    playable_heights = window_values(
        terrain.heights, terrain.size, raster_window(playable, bounds, terrain.size)
    )
    low_elevation = percentile(playable_heights, 0.33)
    high_elevation = percentile(playable_heights, 0.67)
    x_step = (playable[2] - playable[0]) / grid_size
    y_step = (playable[3] - playable[1]) / grid_size
    cells = []
    for row in range(grid_size):
        for column in range(grid_size):
            rect = (
                playable[0] + column * x_step,
                playable[1] + row * y_step,
                playable[0] + (column + 1) * x_step,
                playable[1] + (row + 1) * y_step,
            )
            window = raster_window(rect, bounds, terrain.size)
            elevations = window_values(terrain.heights, terrain.size, window)
            slopes = window_values(terrain.slopes, terrain.size, window)
            selected = [
                feature
                for feature in features
                if rect[0] <= feature["position"][0] < rect[2]
                and rect[1] <= feature["position"][1] < rect[3]
            ]
            counts = Counter(feature["category"] for feature in selected)
            mean_elevation = statistics.fmean(elevations)
            cells.append(
                {
                    "id": cell_id(row, column, grid_size),
                    "row": row,
                    "column": column,
                    "bounds": rect,
                    "nineGridRegion": nine_grid_region(
                        (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2
                    ),
                    "meanElevationMeters": mean_elevation,
                    "minElevationMeters": min(elevations),
                    "maxElevationMeters": max(elevations),
                    "meanSlopeDegrees": statistics.fmean(slopes),
                    "p90SlopeDegrees": percentile(slopes, 0.90),
                    "featureCounts": counts,
                    "elevationBand": (
                        "LOW" if mean_elevation < low_elevation
                        else "HIGH" if mean_elevation > high_elevation
                        else "MID"
                    ),
                }
            )

    building_scores = [
        cell["featureCounts"]["building"] + cell["featureCounts"]["wall"]
        for cell in cells
    ]
    vegetation_counts = [cell["featureCounts"]["vegetation"] for cell in cells]
    nonzero_buildings = [value for value in building_scores if value > 0]
    nonzero_vegetation = [value for value in vegetation_counts if value > 0]
    building_dense_threshold = max(
        3, math.ceil(percentile(nonzero_buildings, 0.60)) if nonzero_buildings else 3
    )
    vegetation_dense_threshold = max(
        3, math.ceil(percentile(nonzero_vegetation, 0.60)) if nonzero_vegetation else 3
    )

    for cell, building_score in zip(cells, building_scores, strict=True):
        counts: Counter[str] = cell["featureCounts"]
        tags = []
        if cell["elevationBand"] == "HIGH":
            tags.append("ELEVATED")
        elif cell["elevationBand"] == "LOW":
            tags.append("LOW_GROUND")
        else:
            tags.append("MID_ELEVATION")

        mean_slope = cell["meanSlopeDegrees"]
        relief = cell["maxElevationMeters"] - cell["minElevationMeters"]
        if mean_slope >= 14 or cell["p90SlopeDegrees"] >= 24:
            tags.append("STEEP")
        elif mean_slope >= 6:
            tags.append("ROLLING")
        else:
            tags.append("FLAT")
        if cell["elevationBand"] == "HIGH" and relief >= 5:
            tags.append("RIDGE_CANDIDATE")
        if building_score >= building_dense_threshold:
            tags.extend(("HARD_COVER_DENSE", "URBAN_CANDIDATE"))
        elif building_score > 0 or counts["obstacle"] >= 4:
            tags.append("HARD_COVER_PRESENT")
        if counts["railway"] >= 2:
            tags.append("LINEAR_CORRIDOR")
        if counts["vegetation"] >= vegetation_dense_threshold:
            tags.append("VEGETATION_DENSE")
        tangible_cover = building_score + counts["obstacle"] + counts["bridge"]
        if tangible_cover <= 1 and counts["vegetation"] <= 1:
            tags.append("OPEN_GROUND_CANDIDATE")

        if "HARD_COVER_DENSE" in tags:
            dominant = "HARD_COVER_ZONE"
        elif "LINEAR_CORRIDOR" in tags:
            dominant = "LINEAR_CORRIDOR"
        elif "ELEVATED" in tags:
            dominant = "ELEVATED_TERRAIN"
        elif "VEGETATION_DENSE" in tags:
            dominant = "VEGETATED_TERRAIN"
        elif "LOW_GROUND" in tags:
            dominant = "LOW_TERRAIN"
        else:
            dominant = "MIXED_TERRAIN"
        cell["semanticTags"] = tags
        cell["dominantClass"] = dominant
        cell["featureCounts"] = dict(sorted(counts.items()))
    return cells


# ---------------------------------------------------------------------------
# Macro regions and relationships
# ---------------------------------------------------------------------------


CLASS_LABELS = {
    "HARD_COVER_ZONE": "硬掩体密集区",
    "LINEAR_CORRIDOR": "线性通道",
    "ELEVATED_TERRAIN": "高地区域",
    "VEGETATED_TERRAIN": "植被密集区",
    "LOW_TERRAIN": "低地区域",
    "MIXED_TERRAIN": "混合地形连接区",
}


def direction_label(
    x: float,
    y: float,
    playable: tuple[float, float, float, float],
) -> str:
    center_x = (playable[0] + playable[2]) / 2
    center_y = (playable[1] + playable[3]) / 2
    nx = (x - center_x) / max(1.0, playable[2] - playable[0])
    ny = (y - center_y) / max(1.0, playable[3] - playable[1])
    horizontal = "东" if nx > 0.16 else "西" if nx < -0.16 else ""
    vertical = "北" if ny > 0.16 else "南" if ny < -0.16 else ""
    return (horizontal + vertical + "侧") if (horizontal or vertical) else "中央"


def area_characteristics(area: dict[str, Any]) -> list[str]:
    tags = set(area["types"])
    evidence = area["evidence"]
    result = [
        f"覆盖网格 {', '.join(area['gridCells'])}",
        (
            f"平均高程 {evidence['meanElevationMeters']:.2f} 米，"
            f"平均坡度 {evidence['meanSlopeDegrees']:.2f}°，"
            f"90 分位坡度 {evidence['p90SlopeDegrees']:.2f}°"
        ),
    ]
    if "HARD_COVER_DENSE" in tags:
        result.append("客户端场景对象名称显示该区域建筑/围墙型硬掩体密集")
    elif "HARD_COVER_PRESENT" in tags:
        result.append("客户端场景对象名称显示该区域存在建筑、围墙或障碍物")
    if "LINEAR_CORRIDOR" in tags:
        result.append("线性基础设施对象连续出现，构成通道候选")
    if "ELEVATED" in tags:
        result.append("区域平均高程处于可玩区高位分组")
    if "LOW_GROUND" in tags:
        result.append("区域平均高程处于可玩区低位分组")
    if "RIDGE_CANDIDATE" in tags:
        result.append("高程与局部起伏同时较高，存在山脊地形候选")
    if "OPEN_GROUND_CANDIDATE" in tags:
        result.append("已识别的建筑、障碍物与植被对象较少，属于开放地候选")
    if "VEGETATION_DENSE" in tags:
        result.append("客户端场景中植被对象相对密集")
    return result


def nine_grid_region(x_mid: float, y_mid: float) -> int:
    """GRID_REGION_1~9 for a semantic-grid cell center, using the backend
    MapRegionResolver convention (canonical 0..500 = raw ±250 m)."""
    cx = min(max(x_mid + NINE_GRID_HALF_EXTENT, 0.0), NINE_GRID_SIZE)
    cy = min(max(y_mid + NINE_GRID_HALF_EXTENT, 0.0), NINE_GRID_SIZE)
    third = NINE_GRID_SIZE / 3.0
    if cx < third:
        column = 0
    elif cx < 2.0 * third:
        column = 1
    else:
        column = 2
    if cy > NINE_GRID_SIZE - third:
        row = 0
    elif cy > NINE_GRID_SIZE - 2.0 * third:
        row = 1
    else:
        row = 2
    return row * 3 + column + 1


def area_affordances(types: set[str]) -> tuple[list[str], list[str]]:
    """Rule-derived candidates, deliberately separate from exact facts."""
    favors: list[str] = []
    risks: list[str] = []
    if "HARD_COVER_DENSE" in types:
        favors.extend(("ARMORED_HEAVY", "SIDESCRAPE_VEHICLE", "HIGH_ALPHA_TRADER"))
        risks.append("建筑密集可能限制横向机动和转场速度")
    if "ELEVATED" in types and "STEEP" not in types:
        favors.append("MOBILE_VEHICLE")
    if "RIDGE_CANDIDATE" in types:
        favors.append("HULL_DOWN_VEHICLE")
        risks.append("低机动车辆进入高地区域的成本可能更高")
    if "OPEN_GROUND_CANDIDATE" in types:
        favors.append("MOBILE_VEHICLE")
        risks.append("缺乏已识别掩体；暴露风险需要视线计算进一步确认")
    if "VEGETATION_DENSE" in types and "HARD_COVER_DENSE" not in types:
        favors.append("CAMOUFLAGE_DEPENDENT_SUPPORT")
        risks.append("植被不等于实体防护，无法阻挡炮弹")
    if "STEEP" in types:
        risks.append("局部陡坡可能限制低机动或俯仰能力较差的车辆")
    return list(dict.fromkeys(favors)), list(dict.fromkeys(risks))


def aggregate_area_tags(component_cells: Sequence[dict[str, Any]]) -> list[str]:
    """Collapse mutually exclusive cell labels into one coherent area profile."""
    tag_counts = Counter(tag for cell in component_cells for tag in cell["semanticTags"])
    count = len(component_cells)
    result: list[str] = []

    for mutually_exclusive in (
        ("ELEVATED", "MID_ELEVATION", "LOW_GROUND"),
        ("FLAT", "ROLLING", "STEEP"),
    ):
        winner = max(mutually_exclusive, key=lambda tag: (tag_counts[tag], -mutually_exclusive.index(tag)))
        if tag_counts[winner] > 0:
            result.append(winner)

    for tag in (
        "RIDGE_CANDIDATE",
        "HARD_COVER_DENSE",
        "URBAN_CANDIDATE",
        "HARD_COVER_PRESENT",
        "LINEAR_CORRIDOR",
        "VEGETATION_DENSE",
        "OPEN_GROUND_CANDIDATE",
    ):
        if tag_counts[tag] >= math.ceil(count / 2):
            result.append(tag)

    # The dominant class was selected per cell, so every connected component
    # must retain its defining tag even when a small component makes rounding
    # thresholds awkward.
    dominant = component_cells[0]["dominantClass"]
    defining_tag = {
        "HARD_COVER_ZONE": "HARD_COVER_DENSE",
        "LINEAR_CORRIDOR": "LINEAR_CORRIDOR",
        "ELEVATED_TERRAIN": "ELEVATED",
        "VEGETATED_TERRAIN": "VEGETATION_DENSE",
        "LOW_TERRAIN": "LOW_GROUND",
    }.get(dominant)
    if defining_tag and defining_tag not in result:
        result.append(defining_tag)
    return result


def build_areas(
    cells: Sequence[dict[str, Any]],
    playable: tuple[float, float, float, float],
    grid_size: int,
) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    by_position = {(cell["row"], cell["column"]): cell for cell in cells}
    seen: set[tuple[int, int]] = set()
    components: list[list[dict[str, Any]]] = []
    for cell in cells:
        start = (cell["row"], cell["column"])
        if start in seen:
            continue
        seen.add(start)
        queue = deque([start])
        component_cells = []
        while queue:
            current = queue.popleft()
            current_cell = by_position[current]
            component_cells.append(current_cell)
            for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                neighbor_key = (current[0] + dr, current[1] + dc)
                neighbor = by_position.get(neighbor_key)
                if neighbor is None or neighbor_key in seen:
                    continue
                if neighbor["dominantClass"] == cell["dominantClass"]:
                    seen.add(neighbor_key)
                    queue.append(neighbor_key)
        components.append(component_cells)

    counters: Counter[str] = Counter()
    areas: dict[str, dict[str, Any]] = {}
    cell_to_area = {}
    for component_cells in components:
        dominant = component_cells[0]["dominantClass"]
        counters[dominant] += 1
        area_id = f"{dominant}_{counters[dominant]:02d}"
        grid_cells = sorted(cell["id"] for cell in component_cells)
        x_min = min(cell["bounds"][0] for cell in component_cells)
        y_min = min(cell["bounds"][1] for cell in component_cells)
        x_max = max(cell["bounds"][2] for cell in component_cells)
        y_max = max(cell["bounds"][3] for cell in component_cells)
        center_x = statistics.fmean((cell["bounds"][0] + cell["bounds"][2]) / 2 for cell in component_cells)
        center_y = statistics.fmean((cell["bounds"][1] + cell["bounds"][3]) / 2 for cell in component_cells)
        all_tags = aggregate_area_tags(component_cells)
        feature_counts: Counter[str] = Counter()
        for cell in component_cells:
            feature_counts.update(cell["featureCounts"])
        evidence = {
            "meanElevationMeters": round(
                statistics.fmean(cell["meanElevationMeters"] for cell in component_cells), 3
            ),
            "minElevationMeters": round(min(cell["minElevationMeters"] for cell in component_cells), 3),
            "maxElevationMeters": round(max(cell["maxElevationMeters"] for cell in component_cells), 3),
            "meanSlopeDegrees": round(
                statistics.fmean(cell["meanSlopeDegrees"] for cell in component_cells), 3
            ),
            "p90SlopeDegrees": round(max(cell["p90SlopeDegrees"] for cell in component_cells), 3),
            "featureCounts": dict(sorted(feature_counts.items())),
        }
        favors, risks = area_affordances(set(all_tags))
        area = {
            "label": direction_label(center_x, center_y, playable) + CLASS_LABELS[dominant],
            "types": all_tags,
            "gridCells": grid_cells,
            "gridRegions": sorted(
                {cell["nineGridRegion"] for cell in component_cells}
            ),
            "boundsMeters": {
                "xMin": round(x_min, 2),
                "yMin": round(y_min, 2),
                "xMax": round(x_max, 2),
                "yMax": round(y_max, 2),
            },
            "evidence": evidence,
            "characteristics": [],
            "favors": favors,
            "risks": risks,
            "confidence": {
                "geometry": "EXACT_CLIENT_DATA",
                "objectPositions": "EXACT_CLIENT_DATA",
                "objectCategories": "NAME_HEURISTIC",
                "areaBoundary": "GRID_RULE_DERIVED",
                "favorsAndRisks": "RULE_DERIVED_CANDIDATE",
            },
        }
        area["characteristics"] = area_characteristics({**area, "id": area_id})
        areas[area_id] = area
        for cell in component_cells:
            cell_to_area[cell["id"]] = area_id
    return areas, cell_to_area


def cell_at_position(
    x: float,
    y: float,
    playable: tuple[float, float, float, float],
    grid_size: int,
) -> str | None:
    if not (playable[0] <= x <= playable[2] and playable[1] <= y <= playable[3]):
        return None
    column = min(grid_size - 1, int((x - playable[0]) / (playable[2] - playable[0]) * grid_size))
    row = min(grid_size - 1, int((y - playable[1]) / (playable[3] - playable[1]) * grid_size))
    return cell_id(row, column, grid_size)


def build_relationships(
    cells: Sequence[dict[str, Any]],
    areas: dict[str, dict[str, Any]],
    cell_to_area: dict[str, str],
    points: Sequence[dict[str, Any]],
    playable: tuple[float, float, float, float],
    grid_size: int,
) -> list[dict[str, Any]]:
    by_position = {(cell["row"], cell["column"]): cell for cell in cells}
    shared_edges: Counter[tuple[str, str]] = Counter()
    for cell in cells:
        for dr, dc in ((1, 0), (0, 1)):
            neighbor = by_position.get((cell["row"] + dr, cell["column"] + dc))
            if neighbor is None:
                continue
            left, right = cell_to_area[cell["id"]], cell_to_area[neighbor["id"]]
            if left != right:
                shared_edges[tuple(sorted((left, right)))] += 1

    relationships: list[dict[str, Any]] = []
    for (left, right), edge_count in sorted(shared_edges.items()):
        relationships.append(
            {
                "from": left,
                "type": "ADJACENT_TO",
                "to": right,
                "reason": f"两个区域在 {edge_count} 条分析网格边上直接相邻",
                "confidence": "EXACT_GRID_TOPOLOGY",
            }
        )
        left_height = areas[left]["evidence"]["meanElevationMeters"]
        right_height = areas[right]["evidence"]["meanElevationMeters"]
        delta = left_height - right_height
        if abs(delta) >= 2.5:
            higher, lower = (left, right) if delta > 0 else (right, left)
            relationships.append(
                {
                    "from": higher,
                    "type": "HIGHER_THAN",
                    "to": lower,
                    "reason": f"相邻区域平均高程差 {abs(delta):.2f} 米",
                    "confidence": "NUMERIC_TERRAIN_DERIVATION",
                }
            )

    for point in points:
        if point["type"] not in ("controlpoint", "strategicpoint"):
            continue
        point_cell = cell_at_position(
            point["position"][0], point["position"][1], playable, grid_size
        )
        if point_cell is None:
            continue
        area = cell_to_area[point_cell]
        relationship_type = (
            "CONTAINS_CONTROL_POINT"
            if point["type"] == "controlpoint"
            else "CONTAINS_STRATEGIC_POINT"
        )
        relationships.append(
            {
                "from": area,
                "type": relationship_type,
                "to": point["name"],
                "reason": f"{point['name']} 的 SC2 坐标位于网格 {point_cell}",
                "confidence": "EXACT_SCENE_DATA",
            }
        )
    return relationships


def build_spawn_semantics(
    points: Sequence[dict[str, Any]],
    playable: tuple[float, float, float, float],
    grid_size: int,
    cell_to_area: dict[str, str],
) -> dict[str, Any]:
    grouped: dict[Any, list[dict[str, Any]]] = defaultdict(list)
    for point in points:
        if point["type"] == "spawnpoint":
            grouped[point.get("team")].append(point)
    result = {}
    for team, spawns in sorted(grouped.items(), key=lambda item: str(item[0])):
        center_x = statistics.fmean(point["position"][0] for point in spawns)
        center_y = statistics.fmean(point["position"][1] for point in spawns)
        center_z = statistics.fmean(point["position"][2] for point in spawns)
        cells = sorted(
            {
                candidate
                for point in spawns
                if (candidate := cell_at_position(
                    point["position"][0], point["position"][1], playable, grid_size
                )) is not None
            }
        )
        result[f"TEAM_{team}"] = {
            "status": "EXACT_SCENE_DATA",
            "spawnCount": len(spawns),
            "centroidMeters": {
                "x": round(center_x, 3),
                "y": round(center_y, 3),
                "z": round(center_z, 3),
            },
            "gridCells": cells,
            "areas": sorted({cell_to_area[cell] for cell in cells}),
        }
    if not result:
        return {
            "TEAM_A": {"status": "UNKNOWN"},
            "TEAM_B": {"status": "UNKNOWN"},
        }
    return result


# ---------------------------------------------------------------------------
# Input, output, and CLI
# ---------------------------------------------------------------------------


def normalized_resource_suffix(path: pathlib.Path) -> str:
    name = path.name.lower()
    return name[:-5] if name.endswith(".dvpl") else name


def discover_map_resources(root: pathlib.Path) -> tuple[pathlib.Path, pathlib.Path]:
    files = [path for path in root.rglob("*") if path.is_file()]
    scenes = [path for path in files if normalized_resource_suffix(path).endswith(".sc2")]
    heightmaps = [
        path for path in files if normalized_resource_suffix(path).endswith(".heightmap")
    ]
    if not scenes:
        raise SemanticizerError(f"No .sc2 or .sc2.dvpl found under {root}")
    if not heightmaps:
        raise SemanticizerError(f"No .heightmap or .heightmap.dvpl found under {root}")
    def resource_rank(path: pathlib.Path, expected_stem: str | None = None) -> tuple[int, int, int]:
        normalized_name = normalized_resource_suffix(path)
        stem = normalized_name[:-4] if normalized_name.endswith(".sc2") else pathlib.Path(normalized_name).stem
        relative_depth = len(path.relative_to(root).parts)
        return (
            int(expected_stem is not None and stem.lower() == expected_stem.lower()),
            -relative_depth,
            path.stat().st_size,
        )

    # Prefer a root-level scene named after the map folder. Only then use depth
    # and size. This avoids accidentally selecting a large linked object scene.
    scene = max(scenes, key=lambda path: resource_rank(path, root.name))
    heightmap = max(heightmaps, key=lambda path: resource_rank(path))
    return scene, heightmap


def infer_map_id(scene_path: pathlib.Path) -> str:
    name = scene_path.name
    if name.lower().endswith(".dvpl"):
        name = name[:-5]
    if name.lower().endswith(".sc2"):
        name = name[:-4]
    return name


def round_cell_for_json(cell: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": cell["id"],
        "nineGridRegion": cell["nineGridRegion"],
        "boundsMeters": {
            "xMin": round(cell["bounds"][0], 2),
            "yMin": round(cell["bounds"][1], 2),
            "xMax": round(cell["bounds"][2], 2),
            "yMax": round(cell["bounds"][3], 2),
        },
        "meanElevationMeters": round(cell["meanElevationMeters"], 3),
        "minElevationMeters": round(cell["minElevationMeters"], 3),
        "maxElevationMeters": round(cell["maxElevationMeters"], 3),
        "meanSlopeDegrees": round(cell["meanSlopeDegrees"], 3),
        "p90SlopeDegrees": round(cell["p90SlopeDegrees"], 3),
        "featureCounts": cell["featureCounts"],
        "semanticTags": cell["semanticTags"],
        "dominantClass": cell["dominantClass"],
        "confidence": "GRID_RULE_DERIVED",
    }


def render_llm_text(document: dict[str, Any]) -> str:
    lines = [
        f"地图：{document['displayName']}（{document['mapId']}）",
        f"战斗变体：{document['battleVariant']}",
        "来源：Wot Blitz 客户端 SC2 + heightmap；未调用 LLM。",
        "",
        "【可信边界】",
        "- 坐标、高程、出生点、占领点：客户端直接数据。",
        "- 对象坐标：客户端直接数据；建筑/铁路/植被等类别由资源名规则识别。",
        "- 区域边界、favors、risks：规则推导候选，不是战术真理。",
        "- 未解析碰撞体、视线和导航前，不生成 CONTROLS 或 ENABLES_PRESSURE_AGAINST。",
        "",
        "【全图事实】",
        (
            f"- 可玩边界：x={document['playableBoundsMeters']['xMin']:.2f}.."
            f"{document['playableBoundsMeters']['xMax']:.2f} m，"
            f"y={document['playableBoundsMeters']['yMin']:.2f}.."
            f"{document['playableBoundsMeters']['yMax']:.2f} m。"
        ),
        (
            f"- 高程：{document['terrain']['playableElevationMeters']['min']:.2f}.."
            f"{document['terrain']['playableElevationMeters']['max']:.2f} m；"
            f"平均坡度 {document['terrain']['playableSlopeDegrees']['mean']:.2f}°，"
            f"P90 {document['terrain']['playableSlopeDegrees']['p90']:.2f}°。"
        ),
        (
            f"- Z 轴交叉校验：{document['terrain']['coordinateValidation']['sampleCount']} 个点，"
            f"MAE {document['terrain']['coordinateValidation']['meanAbsoluteDeltaMeters']:.4f} m，"
            f"P90 {document['terrain']['coordinateValidation']['p90AbsoluteDeltaMeters']:.4f} m。"
        ),
        "",
        "【区域语义】",
    ]
    for area_id, area in document["areas"].items():
        lines.extend(
            [
                f"{area_id}｜{area['label']}",
                f"- 网格：{', '.join(area['gridCells'])}",
                "- 九宫格：" + ", ".join(
                    f"GRID_REGION_{n}" for n in area.get("gridRegions", [])
                ) or "- 九宫格：UNKNOWN",
                f"- 类型：{', '.join(area['types'])}",
            ]
        )
        for characteristic in area["characteristics"]:
            lines.append(f"- 事实：{characteristic}")
        lines.append(
            "- favors（规则候选）：" + (", ".join(area["favors"]) if area["favors"] else "UNKNOWN")
        )
        if area["risks"]:
            for risk in area["risks"]:
                lines.append(f"- risk（规则候选）：{risk}")
        else:
            lines.append("- risks：UNKNOWN")
        counts = area["evidence"]["featureCounts"]
        count_text = ", ".join(f"{key}={value}" for key, value in counts.items()) or "none"
        lines.append(f"- 对象证据：{count_text}")
        lines.append("")

    lines.append("【区域关系】")
    for relation in document["relationships"]:
        lines.append(
            f"- {relation['from']} -> {relation['type']} -> {relation['to']}；"
            f"依据：{relation['reason']}；置信度：{relation['confidence']}"
        )
    if not document["relationships"]:
        lines.append("- UNKNOWN")

    lines.extend(("", "【出生点语义】"))
    for team, semantics in document["spawnSemantics"].items():
        if semantics["status"] == "UNKNOWN":
            lines.append(f"- {team}: UNKNOWN")
        else:
            lines.append(
                f"- {team}: {semantics['spawnCount']} 个出生点；"
                f"网格 {', '.join(semantics['gridCells'])}；"
                f"区域 {', '.join(semantics['areas'])}"
            )
    lines.extend(
        (
            "",
            "【给战术推理模型的约束】",
            "- 可以结合 Tank Tactical Profiles 从以上事实提出战术假设。",
            "- 不得把 RULE_DERIVED_CANDIDATE 当作已验证结论。",
            "- 不得仅凭本文件声称某区域必然控制另一战线、必然存在交叉火力或必然可通行。",
        )
    )
    return "\n".join(lines) + "\n"


def semanticize(
    input_root: pathlib.Path,
    output_dir: pathlib.Path,
    variant: str | None,
    grid_size: int,
    explicit_map_id: str | None,
    display_name: str | None,
    map_codes: Sequence[str] | None = None,
    known_map_codes: Sequence[str] | None = None,
) -> tuple[pathlib.Path, pathlib.Path]:
    scene_path, heightmap_path = discover_map_resources(input_root)
    scene = read_sc2(read_resource(scene_path))
    entities = scene_entities(scene)
    if variant == "auto":
        variant = detect_variant(entities)
    bounds = world_bounds(entities)
    playable = map_border(entities, variant)
    warnings = []
    if playable is None:
        playable = (bounds[0], bounds[1], bounds[3], bounds[4])
        warnings.append(
            f"未找到 {variant} MapBorderComponent；已使用完整 Landscape XY 边界。"
        )
    terrain = load_heightmap(read_resource(heightmap_path), bounds)
    points = battle_points(entities, variant)
    features = scene_features(entities, bounds)
    cells = build_cells(terrain, bounds, playable, features, grid_size)
    areas, cell_to_area = build_areas(cells, playable, grid_size)
    relationships = build_relationships(
        cells, areas, cell_to_area, points, playable, grid_size
    )
    spawns = build_spawn_semantics(points, playable, grid_size, cell_to_area)

    validation_deltas = []
    for point in points:
        if point["type"] not in ("spawnpoint", "controlpoint", "strategicpoint"):
            continue
        x, y, z = point["position"]
        validation_deltas.append(abs(z - sample_height(terrain, bounds, x, y)))
    if not validation_deltas:
        warnings.append("没有可用于 Z 轴交叉校验的出生点/占领点。")

    playable_window = raster_window(playable, bounds, terrain.size)
    playable_heights = window_values(terrain.heights, terrain.size, playable_window)
    playable_slopes = window_values(terrain.slopes, terrain.size, playable_window)
    map_id = explicit_map_id or infer_map_id(scene_path)
    if not map_codes and known_map_codes:
        map_codes = derive_map_codes(map_id, known_map_codes)
    document = {
        "schemaVersion": SCHEMA_VERSION,
        "mapId": map_id,
        "mapCodes": sorted(
            {code.strip() for code in (map_codes or []) if code and code.strip()}
        ),
        "displayName": display_name or map_id,
        "verified": False,
        "source": "CLIENT_RESOURCE_DERIVED",
        "battleVariant": variant or "UNKNOWN",
        "warnings": warnings,
        "sourceFiles": {
            "scene": str(scene_path.relative_to(input_root)),
            "heightmap": str(heightmap_path.relative_to(input_root)),
        },
        "coordinateSystem": {
            "units": "meters",
            "axes": {"x": "map horizontal", "y": "map vertical", "z": "elevation"},
            "worldBounds": {
                "xMin": round(bounds[0], 3),
                "yMin": round(bounds[1], 3),
                "zMin": round(bounds[2], 3),
                "xMax": round(bounds[3], 3),
                "yMax": round(bounds[4], 3),
                "zMax": round(bounds[5], 3),
            },
        },
        "playableBoundsMeters": {
            "xMin": round(playable[0], 3),
            "yMin": round(playable[1], 3),
            "xMax": round(playable[2], 3),
            "yMax": round(playable[3], 3),
        },
        "terrain": {
            "samplesPerAxis": terrain.size,
            "storageTileSize": terrain.tile_size,
            "sampleSpacingMeters": round((terrain.x_spacing + terrain.y_spacing) / 2, 4),
            "playableElevationMeters": {
                "min": round(min(playable_heights), 3),
                "p25": round(percentile(playable_heights, 0.25), 3),
                "median": round(percentile(playable_heights, 0.50), 3),
                "p75": round(percentile(playable_heights, 0.75), 3),
                "max": round(max(playable_heights), 3),
            },
            "playableSlopeDegrees": {
                "mean": round(statistics.fmean(playable_slopes), 3),
                "p90": round(percentile(playable_slopes, 0.90), 3),
                "max": round(max(playable_slopes), 3),
            },
            "coordinateValidation": {
                "method": "SC2 point Z versus bilinear heightmap sampling",
                "sampleCount": len(validation_deltas),
                "meanAbsoluteDeltaMeters": (
                    round(statistics.fmean(validation_deltas), 4) if validation_deltas else 0.0
                ),
                "p90AbsoluteDeltaMeters": (
                    round(percentile(validation_deltas, 0.90), 4) if validation_deltas else 0.0
                ),
            },
        },
        "sceneEvidence": {
            "sceneVersion": scene["$metadata"]["version"],
            "sceneEntityCount": len(entities),
            "featureCounts": dict(sorted(Counter(item["category"] for item in features).items())),
            "battlePoints": points,
        },
        "analysisGrid": {
            "size": f"{grid_size}x{grid_size}",
            "orientation": "A is north/top; 1 is west/left",
            "cells": [round_cell_for_json(cell) for cell in cells],
        },
        "areas": areas,
        "relationships": relationships,
        "spawnSemantics": spawns,
        "confidenceLegend": {
            "EXACT_CLIENT_DATA": "Direct numeric data decoded from client resources.",
            "EXACT_SCENE_DATA": "Direct property or point decoded from SC2.",
            "EXACT_GRID_TOPOLOGY": "Adjacency derived exactly from the declared analysis grid.",
            "NUMERIC_TERRAIN_DERIVATION": "Relationship derived from decoded numeric terrain.",
            "NAME_HEURISTIC": "Category inferred from an asset/entity name; position remains exact.",
            "GRID_RULE_DERIVED": "Area candidate produced by deterministic grid rules.",
            "RULE_DERIVED_CANDIDATE": "Vehicle affordance or risk candidate; requires later validation.",
        },
        "notGeneratedWithoutFurtherEvidence": [
            "CONTROLS",
            "ENABLES_PRESSURE_AGAINST",
            "CROSS_FIRE",
            "GUARANTEED_LINE_OF_SIGHT",
            "GUARANTEED_TRAVERSABLE_ROUTE",
        ],
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / f"{map_id}.semantic.json"
    text_path = output_dir / f"{map_id}.semantic.txt"
    json_path.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    text_path.write_text(render_llm_text(document), encoding="utf-8")
    return json_path, text_path


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Generate auditable WoT Blitz map semantics from SC2 + heightmap resources."
    )
    parser.add_argument("input", type=pathlib.Path, help="Map directory or ZIP file")
    parser.add_argument(
        "--output-dir", type=pathlib.Path, default=pathlib.Path("semantic-output")
    )
    parser.add_argument(
        "--variant",
        default="auto",
        help="Battle variant label (e.g. dt1/cn0); default: auto-detect from SC2 labels",
    )
    parser.add_argument("--grid-size", type=int, default=6, help="Grid cells per axis; default: 6")
    parser.add_argument("--map-id", help="Override the map id inferred from the SC2 filename")
    parser.add_argument(
        "--map-code",
        action="append",
        help="WotBTools internal map code (meta.json mapName, e.g. desert_train); repeatable",
    )
    parser.add_argument(
        "--map-names-file",
        type=pathlib.Path,
        help="common/map_names.json: derive mapCodes for each generated map in batch mode",
    )
    parser.add_argument("--display-name", help="Human-readable map name")
    parser.add_argument(
        "--batch",
        action="store_true",
        help="Treat input as a Maps root and process each immediate map directory",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if not 3 <= args.grid_size <= 12:
        print("error: --grid-size must be between 3 and 12", file=sys.stderr)
        return 2
    source = args.input.expanduser().resolve()
    output_dir = args.output_dir.expanduser().resolve()
    try:
        if args.batch:
            if not source.is_dir():
                raise SemanticizerError("--batch requires a Maps directory")
            if args.map_id or args.display_name or args.map_code:
                raise SemanticizerError(
                    "--map-id, --display-name and --map-code cannot be used with --batch"
                )
            known_codes = load_known_map_codes(args.map_names_file)
            candidates = sorted(path for path in source.iterdir() if path.is_dir())
            processed = []
            failures = []
            for candidate in candidates:
                try:
                    json_path, text_path = semanticize(
                        candidate,
                        output_dir,
                        args.variant,
                        args.grid_size,
                        None,
                        None,
                        None,
                        known_codes,
                    )
                    processed.append((json_path, text_path))
                    print(f"OK: {candidate.name} -> {text_path.name}")
                except (OSError, ValueError, SemanticizerError) as error:
                    failures.append((candidate.name, str(error)))
                    print(f"SKIP: {candidate.name}: {error}", file=sys.stderr)
            if not processed:
                raise SemanticizerError("No map directory was successfully processed")
            print(f"Processed: {len(processed)}; failed/skipped: {len(failures)}")
            return 1 if failures else 0
        if source.is_dir():
            json_path, text_path = semanticize(
                source,
                output_dir,
                args.variant,
                args.grid_size,
                args.map_id,
                args.display_name,
                args.map_code,
                None,
            )
        elif source.is_file() and source.suffix.lower() == ".zip":
            with tempfile.TemporaryDirectory(prefix="wotb-map-") as temporary:
                temporary_root = pathlib.Path(temporary)
                with zipfile.ZipFile(source) as archive:
                    archive.extractall(temporary_root)
                json_path, text_path = semanticize(
                    temporary_root,
                    output_dir,
                    args.variant,
                    args.grid_size,
                    args.map_id,
                    args.display_name,
                    args.map_code,
                    None,
                )
        else:
            raise SemanticizerError(f"Input must be a map directory or ZIP: {source}")
    except (OSError, ValueError, zipfile.BadZipFile, SemanticizerError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    print(f"JSON: {json_path}")
    print(f"LLM text: {text_path}")
    return 0


def load_known_map_codes(path: pathlib.Path | None) -> list[str]:
    if path is None:
        return []
    with path.open(encoding="utf-8") as handle:
        data = json.load(handle)
    if not isinstance(data, dict):
        raise SemanticizerError(f"--map-names-file must be a JSON object: {path}")
    return [str(key) for key in data.keys()]


if __name__ == "__main__":
    raise SystemExit(main())
