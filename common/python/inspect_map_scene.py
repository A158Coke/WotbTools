#!/usr/bin/env python3
"""Inspect one map's main SC2 scene directly from Maps.zip.

This is an evidence tool for 3D Playback research. It reuses the repository's
DVPL + SceneFileV2 parser and reports scene/component/resource-reference facts.
It also inspects SC2 PolygonGroup data nodes and small terrain auxiliary files
referenced by TerrainDataComponent. It does not assign semantic roles to opaque
binary payloads until their formats are decoded.

Usage:
    python common/python/inspect_map_scene.py C:\\path\\to\\Maps.zip 05_amigosville_am
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import struct
import sys
import zipfile
from collections import Counter, defaultdict
from typing import Any, Iterator

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from wotb_sc2 import (  # noqa: E402
    Sc2ParseError,
    decode_dvpl,
    entity_components,
    read_sc2,
)

ASSET_SUFFIX_RE = re.compile(
    r"\.(?:sc2|scg|dds|pvr|png|jpg|jpeg|heightmap|mkm|lka|anim|yaml|material|tex)$",
    re.IGNORECASE,
)
PATHISH_RE = re.compile(r"[/\\]")
ASCII_RUN_RE = re.compile(rb"[\x20-\x7e]{4,}")
TARGET_COMPONENT_TYPES = (
    "CollisionTypeComponent",
    "TerrainDataComponent",
    "StaticOcclusionComponent",
    "StaticOcclusionDataComponent",
)
AUXILIARY_EXTENSIONS = {".mkm", ".lka"}


class InspectError(RuntimeError):
    """Actionable scene inspection error."""


def normalize_member(name: str) -> str:
    return name.replace("\\", "/").lstrip("/")


def decode_scene_payload(raw: bytes, member_name: str) -> bytes:
    """Decode DVPL-wrapped scenes while accepting raw ``.sc2`` members."""

    return (
        decode_dvpl(raw)
        if normalize_member(member_name).lower().endswith(".dvpl")
        else raw
    )


def iter_entities_recursive(
    container: dict[str, Any], path: str = "$"
) -> Iterator[tuple[str, dict[str, Any]]]:
    """Yield every entity in nested DAVA ``#hierarchy`` order."""

    hierarchy = container.get("#hierarchy")
    if not isinstance(hierarchy, list):
        return
    for index, entity in enumerate(hierarchy):
        if not isinstance(entity, dict):
            continue
        entity_path = f"{path}.#hierarchy[{index}]"
        yield entity_path, entity
        yield from iter_entities_recursive(entity, entity_path)


def unwrap_dvpl_suffix(value: str) -> str:
    return value[:-5] if value.lower().endswith(".dvpl") else value


def suffix_key(value: str) -> str:
    normalized = unwrap_dvpl_suffix(value).lower()
    suffix = pathlib.PurePosixPath(normalized.replace("\\", "/")).suffix
    return suffix or "<none>"


def select_scene_member(
    archive: zipfile.ZipFile,
    map_id: str,
    explicit_scene: str | None,
) -> zipfile.ZipInfo:
    files = [info for info in archive.infolist() if not info.is_dir()]
    if explicit_scene:
        wanted = normalize_member(explicit_scene).lower()
        matches = [info for info in files if normalize_member(info.filename).lower() == wanted]
        if len(matches) != 1:
            raise InspectError(
                f"--scene must match exactly one archive member; matched {len(matches)}: {explicit_scene}"
            )
        return matches[0]

    preferred = {
        f"maps/{map_id}/{map_id}.sc2.dvpl".lower(),
        f"{map_id}/{map_id}.sc2.dvpl".lower(),
    }
    exact = [info for info in files if normalize_member(info.filename).lower() in preferred]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        raise InspectError(f"multiple exact main scenes found for {map_id}")

    prefix = f"maps/{map_id}/".lower()
    candidates = [
        info
        for info in files
        if normalize_member(info.filename).lower().startswith(prefix)
        and normalize_member(info.filename).lower().endswith(".sc2.dvpl")
    ]
    if not candidates:
        raise InspectError(f"no SC2 scene found for map: {map_id}")
    rendered = ", ".join(normalize_member(info.filename) for info in candidates[:12])
    raise InspectError(
        f"main SC2 is ambiguous for {map_id}; use --scene with one of: {rendered}"
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


def inspect_scene(scene: dict[str, Any], scene_member: zipfile.ZipInfo, sample_limit: int) -> dict[str, Any]:
    entities = list(iter_entities_recursive(scene))
    component_counts: Counter[str] = Counter()
    component_key_counts: dict[str, Counter[str]] = defaultdict(Counter)
    target_component_samples: dict[str, list[dict[str, Any]]] = defaultdict(list)
    entity_name_samples: list[str] = []
    render_component_keys: Counter[str] = Counter()
    render_object_keys: Counter[str] = Counter()
    render_object_value_types: Counter[str] = Counter()
    render_object_class_counts: Counter[str] = Counter()
    render_batch_keys: Counter[str] = Counter()
    render_batch_value_types: Counter[str] = Counter()
    render_batch_samples: list[dict[str, Any]] = []
    detail_limit = min(sample_limit, 6)

    for entity_index, (entity_path, entity) in enumerate(entities):
        name = entity.get("name")
        if isinstance(name, str):
            add_sample(entity_name_samples, name, sample_limit)
        for component in entity_components(entity):
            type_name = str(component.get("comp.typename", "<unknown>"))
            component_counts[type_name] += 1
            for key in component:
                component_key_counts[type_name][str(key)] += 1
            if type_name in TARGET_COMPONENT_TYPES:
                add_sample(
                    target_component_samples[type_name],
                    {
                        "entityIndex": entity_index,
                        "entityPath": entity_path,
                        "entityName": name,
                        "component": summarize_value(component),
                    },
                    detail_limit,
                )

            if type_name != "RenderComponent":
                continue
            for key in component:
                render_component_keys[str(key)] += 1
            render_object = component.get("rc.renderObj")
            if not isinstance(render_object, dict):
                continue
            render_object_class_counts[str(render_object.get("##name", "<unknown>"))] += 1
            for key, value in render_object.items():
                render_object_keys[str(key)] += 1
                render_object_value_types[f"{key}:{type(value).__name__}"] += 1
            for batch in iter_render_batches(render_object):
                for key, value in batch.items():
                    render_batch_keys[str(key)] += 1
                    render_batch_value_types[f"{key}:{type(value).__name__}"] += 1
                add_sample(render_batch_samples, summarize_value(batch), detail_limit)

    reference_counts: Counter[str] = Counter()
    references_by_extension: dict[str, list[str]] = defaultdict(list)
    reference_paths: dict[str, list[str]] = defaultdict(list)
    binary_field_count = 0
    binary_total_bytes = 0
    binary_key_counts: Counter[str] = Counter()
    binary_key_bytes: Counter[str] = Counter()
    binary_samples: list[dict[str, Any]] = []
    string_samples: list[dict[str, str]] = []

    for path, value in walk(scene):
        if isinstance(value, str):
            if is_resource_reference(value):
                normalized = value.replace("\\", "/")
                extension = suffix_key(normalized)
                reference_counts[extension] += 1
                if normalized not in references_by_extension[extension]:
                    add_sample(references_by_extension[extension], normalized, sample_limit)
                add_sample(reference_paths[normalized], path, 3)
            elif ("render" in path.lower() or "polygon" in path.lower()) and value:
                add_sample(string_samples, {"path": path, "value": value}, sample_limit)
        else:
            payload = byte_payload(value)
            if payload is None:
                continue
            size = len(payload)
            binary_field_count += 1
            binary_total_bytes += size
            terminal_key = path.rsplit(".", 1)[-1]
            binary_key_counts[terminal_key] += 1
            binary_key_bytes[terminal_key] += size
            add_sample(
                binary_samples,
                {
                    "path": path,
                    "bytes": size,
                    "prefixHex": payload[:16].hex(),
                },
                sample_limit,
            )

    unique_references = [
        {
            "value": value,
            "extension": suffix_key(value),
            "paths": paths,
        }
        for value, paths in sorted(reference_paths.items())
    ]

    return {
        "schemaVersion": 3,
        "sceneMember": normalize_member(scene_member.filename),
        "sceneCompressedBytes": scene_member.compress_size,
        "sceneStoredBytes": scene_member.file_size,
        "sceneMetadata": scene.get("$metadata", {}),
        "sceneTraversal": {
            "mode": "recursive #hierarchy",
            "entityCount": len(entities),
        },
        "entityCount": len(entities),
        "entityNameSamples": entity_name_samples,
        "componentTypeCounts": dict(component_counts.most_common()),
        "componentKeyCountsByType": {
            type_name: dict(component_key_counts[type_name].most_common())
            for type_name in TARGET_COMPONENT_TYPES
            if type_name in component_key_counts
        },
        "targetComponentSamples": {
            key: value for key, value in target_component_samples.items()
        },
        "renderComponentKeyCounts": dict(render_component_keys.most_common()),
        "renderObjectClassCounts": dict(render_object_class_counts.most_common()),
        "renderObjectKeyCounts": dict(render_object_keys.most_common()),
        "renderObjectValueTypeCounts": dict(render_object_value_types.most_common()),
        "renderBatchKeyCounts": dict(render_batch_keys.most_common()),
        "renderBatchValueTypeCounts": dict(render_batch_value_types.most_common()),
        "renderBatchSamples": render_batch_samples,
        "dataNodes": inspect_data_nodes(scene, sample_limit),
        "resourceReferences": {
            "countByExtension": dict(reference_counts.most_common()),
            "samplesByExtension": dict(sorted(references_by_extension.items())),
            "unique": unique_references,
        },
        "binaryFields": {
            "count": binary_field_count,
            "totalDecodedBytes": binary_total_bytes,
            "countByTerminalKey": dict(binary_key_counts.most_common()),
            "bytesByTerminalKey": dict(binary_key_bytes.most_common()),
            "samples": binary_samples,
        },
        "renderRelatedStringSamples": string_samples,
        "interpretationRule": (
            "SC2 fields and decoded PolygonGroup metadata are exact format evidence. "
            "Entity/component/render statistics recursively traverse the complete #hierarchy. "
            "CollisionTypeComponent and TerrainDataComponent fields are reported exactly, but "
            "opaque auxiliary payloads remain UNKNOWN until decoded. External DAVA source documents "
            "PolygonGroup vertices/indices layout; actual client vertexFormat still needs decoding."
        ),
    }


def resolve_auxiliary_member(
    archive: zipfile.ZipFile,
    scene_member: zipfile.ZipInfo,
    reference: str,
) -> zipfile.ZipInfo | None:
    base = pathlib.PurePosixPath(normalize_member(scene_member.filename)).parent
    ref = pathlib.PurePosixPath(reference.replace("\\", "/"))
    candidates = [
        normalize_member(str(base / ref)),
        normalize_member(str(base / ref) + ".dvpl"),
    ]
    by_name = {
        normalize_member(info.filename).lower(): info
        for info in archive.infolist()
        if not info.is_dir()
    }
    for candidate in candidates:
        match = by_name.get(candidate.lower())
        if match is not None:
            return match
    return None


def inspect_auxiliary_resources(
    archive: zipfile.ZipFile,
    scene_member: zipfile.ZipInfo,
    report: dict[str, Any],
    sample_limit: int,
) -> list[dict[str, Any]]:
    references = report["resourceReferences"]["unique"]
    results: list[dict[str, Any]] = []
    for reference in references:
        if reference["extension"] not in AUXILIARY_EXTENSIONS:
            continue
        value = str(reference["value"])
        member = resolve_auxiliary_member(archive, scene_member, value)
        if member is None:
            results.append(
                {
                    "reference": value,
                    "extension": reference["extension"],
                    "resolved": False,
                }
            )
            continue

        raw = archive.read(member)
        dvpl_footer = None
        if len(raw) >= 20 and raw[-4:] == b"DVPL":
            unpacked_size, packed_size, crc32, compression_raw, magic = struct.unpack_from(
                "<III4s4s", raw, len(raw) - 20
            )
            dvpl_footer = {
                "unpackedSize": unpacked_size,
                "packedSize": packed_size,
                "crc32": f"{crc32:08x}",
                "compressionType": compression_raw[0],
                "magic": magic.decode("ascii", errors="replace"),
            }

        try:
            decoded = (
                decode_dvpl(raw)
                if normalize_member(member.filename).lower().endswith(".dvpl")
                else raw
            )
        except Sc2ParseError as error:
            results.append(
                {
                    "reference": value,
                    "extension": reference["extension"],
                    "resolved": True,
                    "archiveMember": normalize_member(member.filename),
                    "compressedBytes": member.compress_size,
                    "storedBytes": member.file_size,
                    "dvplFooter": dvpl_footer,
                    "decodeError": str(error),
                    "interpretation": "OPAQUE_BINARY_DECODE_BLOCKED",
                }
            )
            continue

        strings = []
        for match in ASCII_RUN_RE.finditer(decoded):
            value_text = match.group(0).decode("ascii", errors="replace")
            if value_text not in strings:
                add_sample(strings, value_text[:160], sample_limit)
        head_u32 = [
            struct.unpack_from("<I", decoded, offset)[0]
            for offset in range(0, min(len(decoded) - len(decoded) % 4, 32), 4)
        ]
        results.append(
            {
                "reference": value,
                "extension": reference["extension"],
                "resolved": True,
                "archiveMember": normalize_member(member.filename),
                "compressedBytes": member.compress_size,
                "storedBytes": member.file_size,
                "dvplFooter": dvpl_footer,
                "decodedBytes": len(decoded),
                "headHex": decoded[:64].hex(),
                "headAscii": "".join(chr(byte) if 32 <= byte <= 126 else "." for byte in decoded[:64]),
                "headUint32Le": head_u32,
                "asciiStringSamples": strings,
                "interpretation": "OPAQUE_BINARY_UNCLASSIFIED",
            }
        )
    return results


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("input", type=pathlib.Path, help="Path to Maps.zip")
    parser.add_argument("map_id", help="Client map id, e.g. 05_amigosville_am")
    parser.add_argument(
        "--scene",
        help="Exact archive member for maps with multiple SC2 files",
    )
    parser.add_argument(
        "--output",
        type=pathlib.Path,
        help="JSON output; default tmp/map-research/<map-id>-scene-inspection.json",
    )
    parser.add_argument("--sample-limit", type=int, default=30)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    archive_path = args.input.expanduser().resolve()
    if not archive_path.is_file():
        print(f"error: archive not found: {archive_path}", file=sys.stderr)
        return 2
    if args.sample_limit < 1:
        print("error: --sample-limit must be >= 1", file=sys.stderr)
        return 2

    output = args.output or pathlib.Path(
        f"tmp/map-research/{args.map_id}-scene-inspection.json"
    )
    try:
        with zipfile.ZipFile(archive_path) as archive:
            member = select_scene_member(archive, args.map_id, args.scene)
            raw = archive.read(member)
            scene = read_sc2(decode_scene_payload(raw, member.filename))
            report = inspect_scene(scene, member, args.sample_limit)
            report["auxiliaryResources"] = inspect_auxiliary_resources(
                archive, member, report, args.sample_limit
            )
        output = output.expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except (OSError, ValueError, zipfile.BadZipFile, Sc2ParseError, InspectError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    polygon_groups = report["dataNodes"]["polygonGroups"]
    print(
        f"scene inspection: {report['entityCount']} entities, "
        f"{polygon_groups['count']} polygon groups, "
        f"{len(report['resourceReferences']['unique'])} unique resource references -> {output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
