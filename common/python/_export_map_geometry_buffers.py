"""Renderer-neutral geometry buffer serialization."""
from __future__ import annotations
import pathlib
import struct
from collections import Counter
from typing import Any
from wotb_scg import (
    decode_polygon_indices, decode_polygon_positions, polygon_group_vertex_stride,
    position_aabb,
)
from _export_map_geometry_scene import ExportMapGeometryError

def write_geometry_buffers(
    groups_by_id: dict[int, dict[str, Any]],
    required_ids: list[int],
    positions_path: pathlib.Path,
    indices_path: pathlib.Path,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Decode each used PolygonGroup once and write shared derived buffers."""

    geometry_records: list[dict[str, Any]] = []
    position_float_offset = 0
    index_offset = 0
    total_positions = 0
    total_indices = 0
    primitive_types: Counter[str] = Counter()

    with positions_path.open("wb") as positions_file, indices_path.open("wb") as indices_file:
        for datasource_id in required_ids:
            group = groups_by_id.get(datasource_id)
            if group is None:
                raise ExportMapGeometryError(
                    f"SC2 datasource {datasource_id} has no companion SCG PolygonGroup"
                )

            positions = decode_polygon_positions(group)
            indices = decode_polygon_indices(group)
            primitive_type = group.get("rhi_primitiveType")
            primitive_types[str(primitive_type)] += 1

            for x, y, z in positions:
                positions_file.write(struct.pack("<fff", x, y, z))
            if indices:
                indices_file.write(struct.pack(f"<{len(indices)}I", *indices))

            geometry_records.append(
                {
                    "id": datasource_id,
                    "idHex": f"0x{datasource_id:016x}",
                    "vertexFormat": group.get("vertexFormat"),
                    "sourceVertexStrideBytes": polygon_group_vertex_stride(group),
                    "vertexCount": len(positions),
                    "positionFloatOffset": position_float_offset,
                    "positionFloatCount": len(positions) * 3,
                    "indexCount": len(indices),
                    "indexOffset": index_offset,
                    "primitiveType": primitive_type,
                    "primitiveCount": group.get("primitiveCount"),
                    "localAabb": position_aabb(positions),
                }
            )
            position_float_offset += len(positions) * 3
            index_offset += len(indices)
            total_positions += len(positions)
            total_indices += len(indices)

    return geometry_records, {
        "geometryCount": len(geometry_records),
        "totalDecodedPositions": total_positions,
        "totalDecodedIndices": total_indices,
        "primitiveTypes": dict(primitive_types.most_common()),
        "positionsBytes": positions_path.stat().st_size,
        "indicesBytes": indices_path.stat().st_size,
    }
