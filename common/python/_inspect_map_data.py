"""Scene traversal, value summaries and SC2 data-node evidence."""
from __future__ import annotations
from collections import Counter
from typing import Any, Iterator
from _inspect_map_archive import ASSET_SUFFIX_RE, PATHISH_RE, unwrap_dvpl_suffix

TARGET_COMPONENT_TYPES = (
    "CollisionTypeComponent",
    "TerrainDataComponent",
    "StaticOcclusionComponent",
    "StaticOcclusionDataComponent",
)

def walk(value: Any, path: str = "$") -> Iterator[tuple[str, Any]]:
    yield path, value
    if isinstance(value, dict):
        for key, child in value.items():
            yield from walk(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from walk(child, f"{path}[{index}]")

def is_resource_reference(value: str) -> bool:
    candidate = unwrap_dvpl_suffix(value.strip())
    return bool(ASSET_SUFFIX_RE.search(candidate) or (PATHISH_RE.search(candidate) and "." in candidate))

def add_sample(bucket: list[Any], value: Any, limit: int) -> None:
    if len(bucket) < limit:
        bucket.append(value)

def byte_payload(value: Any) -> bytes | None:
    if not isinstance(value, dict) or not isinstance(value.get("$bytes"), str):
        return None
    try:
        return bytes.fromhex(value["$bytes"])
    except ValueError:
        return None

def summarize_value(value: Any, depth: int = 0) -> Any:
    payload = byte_payload(value)
    if payload is not None:
        return {
            "$bytes": len(payload),
            "prefixHex": payload[:16].hex(),
        }
    if depth >= 3:
        if isinstance(value, dict):
            return {"$dictKeys": list(value)[:12], "$dictSize": len(value)}
        if isinstance(value, list):
            return {"$listSize": len(value)}
        return value
    if isinstance(value, dict):
        return {
            str(key): summarize_value(child, depth + 1)
            for key, child in list(value.items())[:30]
        }
    if isinstance(value, list):
        result = [summarize_value(child, depth + 1) for child in value[:12]]
        if len(value) > 12:
            result.append({"$remainingItems": len(value) - 12})
        return result
    return value

def iter_render_batches(render_object: dict[str, Any]) -> Iterator[dict[str, Any]]:
    batches = render_object.get("ro.batches")
    if isinstance(batches, dict):
        for value in batches.values():
            if isinstance(value, dict):
                yield value
    elif isinstance(batches, list):
        for value in batches:
            if isinstance(value, dict):
                yield value

def inspect_data_nodes(scene: dict[str, Any], sample_limit: int) -> dict[str, Any]:
    raw_nodes = scene.get("#dataNodes", [])
    nodes = [node for node in raw_nodes if isinstance(node, dict)] if isinstance(raw_nodes, list) else []

    class_counts: Counter[str] = Counter()
    key_counts: Counter[str] = Counter()
    polygon_groups: list[dict[str, Any]] = []
    total_vertices = 0
    total_indices = 0
    total_primitives = 0
    total_vertex_bytes = 0
    total_index_bytes = 0
    vertex_formats: Counter[str] = Counter()
    index_formats: Counter[str] = Counter()
    primitive_types: Counter[str] = Counter()

    for index, node in enumerate(nodes):
        for key in node:
            key_counts[str(key)] += 1
        class_name = node.get("##name") or node.get("name") or "<unknown>"
        class_counts[str(class_name)] += 1

        is_polygon_group = (
            str(class_name) == "PolygonGroup"
            or all(key in node for key in ("vertexCount", "indexCount", "vertices", "indices"))
        )
        if not is_polygon_group:
            continue

        vertex_count = int(node.get("vertexCount", 0) or 0)
        index_count = int(node.get("indexCount", 0) or 0)
        primitive_count = int(node.get("primitiveCount", 0) or 0)
        vertices = byte_payload(node.get("vertices"))
        indices = byte_payload(node.get("indices"))
        total_vertices += vertex_count
        total_indices += index_count
        total_primitives += primitive_count
        total_vertex_bytes += len(vertices) if vertices is not None else 0
        total_index_bytes += len(indices) if indices is not None else 0
        vertex_formats[str(node.get("vertexFormat", "<missing>"))] += 1
        index_formats[str(node.get("indexFormat", "<missing>"))] += 1
        primitive_types[str(node.get("rhi_primitiveType", "<missing>"))] += 1

        add_sample(
            polygon_groups,
            {
                "dataNodeIndex": index,
                "className": str(class_name),
                "vertexFormat": node.get("vertexFormat"),
                "vertexCount": vertex_count,
                "indexCount": index_count,
                "textureCoordCount": node.get("textureCoordCount"),
                "primitiveType": node.get("rhi_primitiveType"),
                "primitiveCount": primitive_count,
                "packing": node.get("packing"),
                "indexFormat": node.get("indexFormat"),
                "cubeTextureCoordCount": node.get("cubeTextureCoordCount"),
                "vertexBytes": len(vertices) if vertices is not None else None,
                "indexBytes": len(indices) if indices is not None else None,
                "vertexPrefixHex": vertices[:24].hex() if vertices else None,
                "indexPrefixHex": indices[:24].hex() if indices else None,
            },
            sample_limit,
        )

    return {
        "count": len(nodes),
        "classCounts": dict(class_counts.most_common()),
        "keyCounts": dict(key_counts.most_common()),
        "polygonGroups": {
            "count": sum(vertex_formats.values()),
            "totalVertices": total_vertices,
            "totalIndices": total_indices,
            "totalPrimitiveCount": total_primitives,
            "totalVertexBytes": total_vertex_bytes,
            "totalIndexBytes": total_index_bytes,
            "vertexFormats": dict(vertex_formats.most_common()),
            "indexFormats": dict(index_formats.most_common()),
            "primitiveTypes": dict(primitive_types.most_common()),
            "samples": polygon_groups,
        },
    }
