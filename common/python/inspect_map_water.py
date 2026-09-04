#!/usr/bin/env python3
"""Inspect Water render objects without exporting client water geometry.

This tool is deliberately metadata-only. It reports Water RenderObject presence,
visibility, world transforms, local render-object bbox facts, and referenced SCG
PolygonGroup statistics/AABBs. It never writes polygon vertices, indices,
textures, materials, shaders, or other client presentation assets.

Use this before implementing procedural water so the renderer can consume only
proven surface parameters instead of copying a client water mesh.
"""

from __future__ import annotations

import argparse
import json
import pathlib
import struct
import sys
import zipfile
from typing import Any

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from export_map_geometry_poc import (  # noqa: E402
    batch_is_active,
    batch_option,
    component_by_type,
    iter_entities_recursive,
    iter_render_batches,
    normalize_member,
    render_object_is_visible,
    select_companion_scg,
    select_scene_member,
    world_transform,
)
from wotb_sc2 import Sc2ParseError, decode_bytes, decode_dvpl, read_sc2  # noqa: E402
from wotb_scg import (  # noqa: E402
    decode_polygon_indices,
    decode_polygon_positions,
    polygon_groups_by_id,
    position_aabb,
    read_scg,
)


class WaterInspectionError(RuntimeError):
    """Actionable water-inspection failure."""


def decode_resource(raw: bytes, member_name: str) -> bytes:
    return decode_dvpl(raw) if normalize_member(member_name).lower().endswith(".dvpl") else raw


def decode_bbox(render_object: dict[str, Any]) -> dict[str, list[float]] | None:
    payload = decode_bytes(render_object.get("bbox"))
    if payload is None:
        return None
    if len(payload) != 24:
        raise WaterInspectionError(f"Water RenderObject bbox has {len(payload)} bytes, expected 24")
    values = struct.unpack("<6f", payload)
    return {
        "min": [float(values[0]), float(values[1]), float(values[2])],
        "max": [float(values[3]), float(values[4]), float(values[5])],
    }


def summarize_water(
    scene: dict[str, Any],
    groups_by_id: dict[int, dict[str, Any]],
    target_lod: int = 0,
    target_switch: int = 0,
) -> list[dict[str, Any]]:
    waters: list[dict[str, Any]] = []
    for entity_path, entity in iter_entities_recursive(scene):
        render = component_by_type(entity, "RenderComponent")
        if render is None:
            continue
        render_object = render.get("rc.renderObj")
        if not isinstance(render_object, dict) or str(render_object.get("##name", "")) != "Water":
            continue

        batches = []
        for batch_index, batch in iter_render_batches(render_object):
            datasource = batch.get("rb.datasource")
            lod_index = batch_option(render_object, batch_index, "lodIndex")
            switch_index = batch_option(render_object, batch_index, "switchIndex")
            record: dict[str, Any] = {
                "batchIndex": batch_index,
                "datasourceId": datasource if isinstance(datasource, int) else None,
                "lodIndex": lod_index,
                "switchIndex": switch_index,
                "activeAtRequestedState": (
                    batch_is_active(lod_index, target_lod)
                    and batch_is_active(switch_index, target_switch)
                ),
            }
            if isinstance(datasource, int):
                group = groups_by_id.get(datasource)
                if group is not None:
                    positions = decode_polygon_positions(group)
                    indices = decode_polygon_indices(group)
                    aabb = position_aabb(positions)
                    record.update({
                        "polygonGroupFound": True,
                        "vertexCount": len(positions),
                        "indexCount": len(indices),
                        "primitiveType": group.get("rhi_primitiveType"),
                        "localGeometryAabb": {
                            "min": list(aabb[0]),
                            "max": list(aabb[1]),
                            "zSpanMeters": float(aabb[1][2] - aabb[0][2]),
                        },
                    })
                else:
                    record["polygonGroupFound"] = False
            batches.append(record)

        waters.append({
            "entityPath": entity_path,
            "entityName": entity.get("name") if isinstance(entity.get("name"), str) else None,
            "visible": render_object_is_visible(render_object),
            "worldTransform": world_transform(entity),
            "renderObjectBbox": decode_bbox(render_object),
            "batchCount": len(batches),
            "batches": batches,
        })
    return waters


def inspect_archive(maps_zip: pathlib.Path, map_id: str) -> dict[str, Any]:
    with zipfile.ZipFile(maps_zip) as archive:
        scene_member = select_scene_member(archive, map_id)
        scg_member = select_companion_scg(archive, scene_member)
        scene = read_sc2(decode_resource(archive.read(scene_member), scene_member.filename))
        scg = read_scg(decode_resource(archive.read(scg_member), scg_member.filename))
        groups = scg.get("polygonGroups")
        if not isinstance(groups, list):
            raise WaterInspectionError("SCG polygonGroups is missing")
        groups_by_id = polygon_groups_by_id(groups)
        waters = summarize_water(scene, groups_by_id)
        return {
            "schemaVersion": 1,
            "purpose": "METADATA_ONLY_WATER_EVIDENCE",
            "mapId": map_id,
            "sceneMember": normalize_member(scene_member.filename),
            "scgMember": normalize_member(scg_member.filename),
            "waterObjectCount": len(waters),
            "waters": waters,
            "copyrightBoundary": {
                "exportsVertices": False,
                "exportsIndices": False,
                "exportsTextures": False,
                "exportsMaterials": False,
                "exportsShaders": False,
            },
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("maps_zip", type=pathlib.Path, help="Path to client Maps.zip")
    parser.add_argument("map_ids", nargs="+", help="Client map ids, e.g. 18_canal_cn 14_port_pt")
    parser.add_argument("--output-dir", type=pathlib.Path, default=pathlib.Path("tmp/map-research"))
    args = parser.parse_args()

    maps_zip = args.maps_zip.expanduser().resolve()
    if not maps_zip.is_file():
        print(f"error: Maps.zip not found: {maps_zip}", file=sys.stderr)
        return 2
    args.output_dir.mkdir(parents=True, exist_ok=True)

    try:
        for map_id in args.map_ids:
            report = inspect_archive(maps_zip, map_id)
            output = args.output_dir / f"{map_id}-water-evidence.json"
            output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            print(f"{map_id}: {report['waterObjectCount']} Water object(s) -> {output}")
    except (OSError, zipfile.BadZipFile, Sc2ParseError, WaterInspectionError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
