#!/usr/bin/env python3
"""Inspect one map's SCG geometry sidecar and cross-check SC2 RenderBatch ids.

Usage:
    python common/python/inspect_map_scg.py C:\\path\\to\\Maps.zip 05_amigosville_am

The report is evidence-oriented: it verifies the actual SCPG payload, summarizes
PolygonGroup geometry, and checks whether SC2 ``rb.datasource`` ids resolve to
PolygonGroup ``#id`` values.  It does not export or redistribute raw client
geometry.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import sys
import zipfile
from collections import Counter
from typing import Any, Iterator

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from wotb_sc2 import (  # noqa: E402
    Sc2ParseError,
    decode_bytes,
    decode_dvpl,
    entity_components,
    read_sc2,
    scene_entities,
)
from wotb_scg import read_scg  # noqa: E402


VERTEX_ATTRIBUTES = {
    0: "VERTEX",
    1: "NORMAL",
    2: "COLOR",
    3: "TEXCOORD0",
    4: "TEXCOORD1",
    5: "TEXCOORD2",
    6: "TEXCOORD3",
    7: "TANGENT",
    8: "BINORMAL",
    9: "HARD_JOINTINDEX",
    10: "PIVOT4",
    11: "PIVOT_DEPRECATED",
    12: "FLEXIBILITY",
    13: "ANGLE_SIN_COS",
    14: "JOINTINDEX",
    15: "JOINTWEIGHT",
    16: "CUBETEXCOORD0",
    17: "CUBETEXCOORD1",
    18: "CUBETEXCOORD2",
    19: "CUBETEXCOORD3",
}


class InspectScgError(RuntimeError):
    """Actionable SCG inspection error."""


def normalize_member(name: str) -> str:
    return name.replace("\\", "/").lstrip("/")


def archive_files(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    return [info for info in archive.infolist() if not info.is_dir()]


def select_scene_member(archive: zipfile.ZipFile, map_id: str) -> zipfile.ZipInfo:
    by_name = {normalize_member(info.filename).lower(): info for info in archive_files(archive)}
    for candidate in (
        f"Maps/{map_id}/{map_id}.sc2.dvpl",
        f"{map_id}/{map_id}.sc2.dvpl",
        f"Maps/{map_id}/{map_id}.sc2",
        f"{map_id}/{map_id}.sc2",
    ):
        match = by_name.get(candidate.lower())
        if match is not None:
            return match
    raise InspectScgError(f"main SC2 not found for map: {map_id}")


def select_companion_scg(
    archive: zipfile.ZipFile,
    scene_member: zipfile.ZipInfo,
) -> zipfile.ZipInfo:
    scene_name = normalize_member(scene_member.filename)
    lower = scene_name.lower()
    candidates: list[str] = []
    if lower.endswith(".sc2.dvpl"):
        candidates.extend((scene_name[:-9] + ".scg.dvpl", scene_name[:-9] + ".scg"))
    elif lower.endswith(".sc2"):
        candidates.extend((scene_name[:-4] + ".scg", scene_name[:-4] + ".scg.dvpl"))

    by_name = {normalize_member(info.filename).lower(): info for info in archive_files(archive)}
    for candidate in candidates:
        match = by_name.get(candidate.lower())
        if match is not None:
            return match

    parent = pathlib.PurePosixPath(scene_name).parent
    siblings = [
        info
        for info in archive_files(archive)
        if pathlib.PurePosixPath(normalize_member(info.filename)).parent == parent
        and normalize_member(info.filename).lower().endswith((".scg", ".scg.dvpl"))
    ]
    if len(siblings) == 1:
        return siblings[0]
    rendered = ", ".join(normalize_member(info.filename) for info in siblings[:12]) or "none"
    raise InspectScgError(
        f"no unambiguous companion SCG for {scene_name}; sibling SCG candidates: {rendered}"
    )


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


def collect_datasource_ids(scene: dict[str, Any]) -> Counter[int]:
    result: Counter[int] = Counter()
    for entity in scene_entities(scene):
        for component in entity_components(entity):
            if component.get("comp.typename") != "RenderComponent":
                continue
            render_object = component.get("rc.renderObj")
            if not isinstance(render_object, dict):
                continue
            for batch in iter_render_batches(render_object):
                datasource = batch.get("rb.datasource")
                if isinstance(datasource, int):
                    result[datasource] += 1
    return result


def group_id(group: dict[str, Any]) -> int | None:
    value = group.get("#id")
    if isinstance(value, int):
        return value
    payload = decode_bytes(value)
    if payload is None or not payload or len(payload) > 8:
        return None
    return int.from_bytes(payload, "little", signed=False)


def vertex_attributes(vertex_format: Any) -> list[str]:
    if not isinstance(vertex_format, int):
        return []
    return [name for bit, name in VERTEX_ATTRIBUTES.items() if vertex_format & (1 << bit)]


def summarize_groups(groups: list[dict[str, Any]], sample_limit: int) -> dict[str, Any]:
    vertex_formats: Counter[str] = Counter()
    index_formats: Counter[str] = Counter()
    primitive_types: Counter[str] = Counter()
    vertex_strides: Counter[str] = Counter()
    ids: list[int] = []
    total_vertices = 0
    total_indices = 0
    total_primitives = 0
    total_vertex_bytes = 0
    total_index_bytes = 0
    invalid_index_payloads = 0
    samples: list[dict[str, Any]] = []

    for index, group in enumerate(groups):
        vertex_count = int(group.get("vertexCount", 0) or 0)
        index_count = int(group.get("indexCount", 0) or 0)
        primitive_count = int(group.get("primitiveCount", 0) or 0)
        vertex_payload = decode_bytes(group.get("vertices"))
        index_payload = decode_bytes(group.get("indices"))
        vertex_bytes = len(vertex_payload) if vertex_payload is not None else 0
        index_bytes = len(index_payload) if index_payload is not None else 0
        vertex_format = group.get("vertexFormat")
        index_format = group.get("indexFormat")
        primitive_type = group.get("rhi_primitiveType")
        identifier = group_id(group)

        total_vertices += vertex_count
        total_indices += index_count
        total_primitives += primitive_count
        total_vertex_bytes += vertex_bytes
        total_index_bytes += index_bytes
        vertex_formats[str(vertex_format)] += 1
        index_formats[str(index_format)] += 1
        primitive_types[str(primitive_type)] += 1
        if identifier is not None:
            ids.append(identifier)

        stride: int | None = None
        if vertex_count > 0 and vertex_bytes % vertex_count == 0:
            stride = vertex_bytes // vertex_count
            vertex_strides[str(stride)] += 1

        expected_index_bytes = None
        if index_format == 0:
            expected_index_bytes = index_count * 2
        elif index_format == 1:
            expected_index_bytes = index_count * 4
        if expected_index_bytes is not None and expected_index_bytes != index_bytes:
            invalid_index_payloads += 1

        if len(samples) < sample_limit:
            samples.append(
                {
                    "polygonGroupIndex": index,
                    "id": identifier,
                    "idHex": f"0x{identifier:016x}" if identifier is not None else None,
                    "vertexFormat": vertex_format,
                    "vertexAttributes": vertex_attributes(vertex_format),
                    "vertexCount": vertex_count,
                    "vertexBytes": vertex_bytes,
                    "vertexStrideBytes": stride,
                    "indexFormat": index_format,
                    "indexCount": index_count,
                    "indexBytes": index_bytes,
                    "primitiveType": primitive_type,
                    "primitiveCount": primitive_count,
                    "textureCoordCount": group.get("textureCoordCount"),
                    "cubeTextureCoordCount": group.get("cubeTextureCoordCount"),
                    "packing": group.get("packing"),
                    "vertexPrefixHex": vertex_payload[:24].hex() if vertex_payload else None,
                    "indexPrefixHex": index_payload[:24].hex() if index_payload else None,
                }
            )

    return {
        "count": len(groups),
        "groupsWithId": len(ids),
        "uniqueIds": len(set(ids)),
        "totalVertices": total_vertices,
        "totalIndices": total_indices,
        "totalPrimitiveCount": total_primitives,
        "totalVertexBytes": total_vertex_bytes,
        "totalIndexBytes": total_index_bytes,
        "vertexFormats": dict(vertex_formats.most_common()),
        "vertexStrideBytes": dict(vertex_strides.most_common()),
        "indexFormats": dict(index_formats.most_common()),
        "primitiveTypes": dict(primitive_types.most_common()),
        "indexPayloadMismatchCount": invalid_index_payloads,
        "samples": samples,
    }


def datasource_cross_check(
    datasource_counts: Counter[int],
    groups: list[dict[str, Any]],
    sample_limit: int,
) -> dict[str, Any]:
    group_ids = {identifier for group in groups if (identifier := group_id(group)) is not None}
    datasource_ids = set(datasource_counts)
    matched_ids = datasource_ids & group_ids
    unmatched_datasource_ids = datasource_ids - group_ids
    unreferenced_group_ids = group_ids - datasource_ids
    return {
        "renderBatchDatasourceOccurrences": sum(datasource_counts.values()),
        "uniqueRenderBatchDatasourceIds": len(datasource_ids),
        "polygonGroupIds": len(group_ids),
        "matchedUniqueDatasourceIds": len(matched_ids),
        "matchedRenderBatchOccurrences": sum(datasource_counts[value] for value in matched_ids),
        "unmatchedUniqueDatasourceIds": len(unmatched_datasource_ids),
        "unmatchedDatasourceIdSamples": sorted(unmatched_datasource_ids)[:sample_limit],
        "unreferencedPolygonGroupIds": len(unreferenced_group_ids),
        "unreferencedPolygonGroupIdSamples": sorted(unreferenced_group_ids)[:sample_limit],
        "interpretation": (
            "Exact integer-id equality between SC2 RenderBatch rb.datasource and SCPG PolygonGroup #id. "
            "A high match rate proves the SC2 render batches consume geometry from this SCG sidecar."
        ),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("input", type=pathlib.Path, help="Path to Maps.zip")
    parser.add_argument("map_id", help="Client map id, e.g. 05_amigosville_am")
    parser.add_argument(
        "--output",
        type=pathlib.Path,
        help="JSON output; default tmp/map-research/<map-id>-scg-inspection.json",
    )
    parser.add_argument("--sample-limit", type=int, default=20)
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
        f"tmp/map-research/{args.map_id}-scg-inspection.json"
    )
    try:
        with zipfile.ZipFile(archive_path) as archive:
            scene_member = select_scene_member(archive, args.map_id)
            scg_member = select_companion_scg(archive, scene_member)
            scene_raw = archive.read(scene_member)
            scg_raw = archive.read(scg_member)

        scene_payload = decode_dvpl(scene_raw) if normalize_member(scene_member.filename).lower().endswith(".dvpl") else scene_raw
        scg_payload = decode_dvpl(scg_raw) if normalize_member(scg_member.filename).lower().endswith(".dvpl") else scg_raw
        scene = read_sc2(scene_payload)
        scg = read_scg(scg_payload)
        groups = [group for group in scg.get("polygonGroups", []) if isinstance(group, dict)]
        datasource_counts = collect_datasource_ids(scene)

        report = {
            "schemaVersion": 1,
            "mapId": args.map_id,
            "sceneMember": normalize_member(scene_member.filename),
            "scgMember": normalize_member(scg_member.filename),
            "sceneDecodedBytes": len(scene_payload),
            "scgDecodedBytes": len(scg_payload),
            "scgMetadata": scg.get("$metadata", {}),
            "polygonGroups": summarize_groups(groups, args.sample_limit),
            "datasourceCrossCheck": datasource_cross_check(
                datasource_counts, groups, args.sample_limit
            ),
            "evidenceRule": (
                "SCPG header, KeyedArchive PolygonGroup fields, byte sizes, ids, and datasource-id matches "
                "are decoded facts. Vertex attribute names follow the public SCPG bitmask documentation; "
                "actual vertex component storage must be validated before exporting geometry."
            ),
        }

        output = output.expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    except (OSError, ValueError, zipfile.BadZipFile, Sc2ParseError, InspectScgError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    summary = report["polygonGroups"]
    cross = report["datasourceCrossCheck"]
    print(
        f"SCG inspection: {summary['count']} polygon groups, "
        f"{summary['totalVertices']} vertices, {summary['totalIndices']} indices; "
        f"matched {cross['matchedUniqueDatasourceIds']}/{cross['uniqueRenderBatchDatasourceIds']} "
        f"unique SC2 datasource ids -> {output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
