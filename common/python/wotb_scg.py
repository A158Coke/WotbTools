"""WoT Blitz / DAVA SCPG (.scg) reader and minimal geometry decoder.

The outer DVPL layer is handled by :mod:`wotb_sc2`. SCPG itself is a small
header followed by ``nodeCount`` DAVA KeyedArchives. This module deliberately
reuses the repository's existing ``Reader`` / ``read_archive`` implementation.

Only position/index decoding required by the 3D map research PoC lives here.
Materials, normals, tangents, UVs, and runtime-renderer concerns remain outside
this module.

Reference format documentation:
https://github.com/Pyogenics/WOTBSCPGFormat/wiki/SCG-file-format
"""

from __future__ import annotations

import math
import struct
from typing import Any

from wotb_sc2 import Reader, Sc2ParseError, decode_bytes, read_archive


SCG_MAGIC = b"SCPG"
MAX_REASONABLE_NODE_COUNT = 1_000_000

# DAVA eVertexFormat bit 0. PolygonGroup::UpdateDataPointersAndStreams handles
# EVF_VERTEX first and exposes it as a float3 position stream.
EVF_VERTEX = 1 << 0

INDEX_FORMAT_UINT16 = 0
INDEX_FORMAT_UINT32 = 1


def read_scg(raw: bytes) -> dict[str, Any]:
    """Decode an SCPG payload after DVPL decompression.

    Known WotB SCPG v1 layout:

    ``SCPG | uint32 version | uint32 nodeCount | uint32 nodeCount2 | KA...``

    The two node counts are expected to agree. A mismatch is retained as a
    warning rather than silently choosing a different count.
    """

    reader = Reader(raw)
    if reader.take(4) != SCG_MAGIC:
        raise Sc2ParseError("Geometry resource is not an SCPG (.scg) payload")

    version = reader.u32()
    node_count = reader.u32()
    node_count2 = reader.u32()
    if node_count > MAX_REASONABLE_NODE_COUNT:
        raise Sc2ParseError(f"Unreasonable SCPG node count: {node_count}")

    warnings: list[str] = []
    if version != 1:
        warnings.append(f"SCPG version is {version}; public reference documents version 1")
    if node_count != node_count2:
        warnings.append(
            f"SCPG duplicated node counts differ: nodeCount={node_count}, nodeCount2={node_count2}"
        )

    polygon_groups = [read_archive(reader) for _ in range(node_count)]
    trailing_bytes = len(raw) - reader.offset
    if trailing_bytes:
        warnings.append(f"SCPG has {trailing_bytes} trailing bytes after declared polygon groups")

    return {
        "$metadata": {
            "version": version,
            "declaredNodeCount": node_count,
            "declaredNodeCount2": node_count2,
            "parsedBytes": reader.offset,
            "fileBytes": len(raw),
            "trailingBytes": trailing_bytes,
            "warnings": warnings,
        },
        "polygonGroups": polygon_groups,
    }


def polygon_group_id(group: dict[str, Any]) -> int | None:
    """Return the unsigned PolygonGroup ``#id`` used by SC2 ``rb.datasource``."""

    value = group.get("#id")
    if isinstance(value, int):
        return value
    payload = decode_bytes(value)
    if payload is None or not payload or len(payload) > 8:
        return None
    return int.from_bytes(payload, "little", signed=False)


def polygon_group_vertex_stride(group: dict[str, Any]) -> int:
    """Derive and validate the interleaved vertex stride from the payload."""

    vertex_count = group.get("vertexCount")
    payload = decode_bytes(group.get("vertices"))
    if not isinstance(vertex_count, int) or vertex_count <= 0:
        raise Sc2ParseError("PolygonGroup has invalid vertexCount")
    if payload is None:
        raise Sc2ParseError("PolygonGroup has no decodable vertices byte array")
    if len(payload) % vertex_count != 0:
        raise Sc2ParseError(
            f"PolygonGroup vertex payload size {len(payload)} is not divisible by vertexCount {vertex_count}"
        )
    stride = len(payload) // vertex_count
    if stride < 12:
        raise Sc2ParseError(f"PolygonGroup vertex stride {stride} is too small for float3 position")
    return stride


def decode_polygon_positions(group: dict[str, Any]) -> list[tuple[float, float, float]]:
    """Decode the DAVA EVF_VERTEX float3 at offset zero of each interleaved vertex."""

    vertex_format = group.get("vertexFormat")
    if not isinstance(vertex_format, int) or not (vertex_format & EVF_VERTEX):
        raise Sc2ParseError("PolygonGroup vertexFormat does not contain EVF_VERTEX")

    vertex_count = group.get("vertexCount")
    if not isinstance(vertex_count, int) or vertex_count <= 0:
        raise Sc2ParseError("PolygonGroup has invalid vertexCount")
    payload = decode_bytes(group.get("vertices"))
    if payload is None:
        raise Sc2ParseError("PolygonGroup has no decodable vertices byte array")

    stride = polygon_group_vertex_stride(group)
    positions: list[tuple[float, float, float]] = []
    for index in range(vertex_count):
        position = struct.unpack_from("<fff", payload, index * stride)
        if not all(math.isfinite(value) for value in position):
            raise Sc2ParseError(
                f"PolygonGroup contains non-finite position at vertex {index}: {position}"
            )
        positions.append(position)
    return positions


def decode_polygon_indices(group: dict[str, Any]) -> list[int]:
    """Decode PolygonGroup indices and validate they address the local vertex array."""

    index_count = group.get("indexCount")
    vertex_count = group.get("vertexCount")
    index_format = group.get("indexFormat")
    payload = decode_bytes(group.get("indices"))
    if not isinstance(index_count, int) or index_count < 0:
        raise Sc2ParseError("PolygonGroup has invalid indexCount")
    if not isinstance(vertex_count, int) or vertex_count <= 0:
        raise Sc2ParseError("PolygonGroup has invalid vertexCount")
    if payload is None:
        raise Sc2ParseError("PolygonGroup has no decodable indices byte array")

    if index_format == INDEX_FORMAT_UINT16:
        item_size = 2
        format_code = "H"
    elif index_format == INDEX_FORMAT_UINT32:
        item_size = 4
        format_code = "I"
    else:
        raise Sc2ParseError(f"Unsupported PolygonGroup indexFormat {index_format!r}")

    expected = index_count * item_size
    if len(payload) != expected:
        raise Sc2ParseError(
            f"PolygonGroup index payload mismatch: expected {expected}, got {len(payload)}"
        )

    if index_count == 0:
        return []
    indices = list(struct.unpack(f"<{index_count}{format_code}", payload))
    invalid = next((value for value in indices if value >= vertex_count), None)
    if invalid is not None:
        raise Sc2ParseError(
            f"PolygonGroup index {invalid} is outside vertexCount {vertex_count}"
        )
    return indices


def position_aabb(
    positions: list[tuple[float, float, float]],
) -> dict[str, list[float]]:
    """Return a JSON-friendly local-space AABB for decoded positions."""

    if not positions:
        raise Sc2ParseError("Cannot compute AABB for empty position list")
    return {
        "min": [min(position[axis] for position in positions) for axis in range(3)],
        "max": [max(position[axis] for position in positions) for axis in range(3)],
    }
