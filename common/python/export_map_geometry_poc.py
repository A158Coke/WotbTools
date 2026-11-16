#!/usr/bin/env python3
"""Export a renderer-neutral derived map-geometry PoC from Maps.zip.

The output intentionally strips textures, materials, normals, tangents, and
other client presentation data. It writes one shared local-space position/index
buffer plus an instance manifest containing the SC2 world transforms.

DAVA RenderObject activates a batch when both its LOD and switch index equal the
requested value or are ``-1`` (shared/wildcard). Initial scene visibility is a
separate RenderObject contract: the serialized ``ro.flags`` VISIBLE bit must be
set. This exporter mirrors both rules instead of inferring state from filenames.
"""
from __future__ import annotations
import argparse
import json
import pathlib
import sys
import zipfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from wotb_sc2 import Sc2ParseError, decode_dvpl, entity_components, read_sc2  # noqa: E402
from wotb_scg import (  # noqa: E402
    decode_polygon_indices, decode_polygon_positions, polygon_group_vertex_stride,
    polygon_groups_by_id, position_aabb, read_scg,
)
from _export_map_geometry_scene import (  # noqa: E402
    ExportMapGeometryError, RENDER_OBJECT_VISIBLE_FLAG, SHARED_BATCH_INDEX,
    archive_files, batch_is_active, batch_option, collect_instances,
    component_by_type, iter_entities_recursive, iter_render_batches,
    normalize_member, render_object_is_visible, select_companion_scg,
    select_scene_member, vector, world_transform,
)
from _export_map_geometry_buffers import write_geometry_buffers  # noqa: E402

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("input", type=pathlib.Path, help="Path to Maps.zip")
    parser.add_argument("map_id", help="Client map id, e.g. 18_canal_cn")
    parser.add_argument(
        "--output-dir",
        type=pathlib.Path,
        default=pathlib.Path("tmp/map-research"),
        help="Derived PoC output directory; defaults to tmp/map-research",
    )
    parser.add_argument("--lod", type=int, default=0, help="Requested active LOD index")
    parser.add_argument(
        "--switch",
        type=int,
        default=0,
        dest="switch_index",
        help="Requested active switch/state index",
    )
    return parser

def main() -> int:
    args = build_parser().parse_args()
    archive_path = args.input.expanduser().resolve()
    if not archive_path.is_file():
        print(f"error: archive not found: {archive_path}", file=sys.stderr)
        return 2
    if args.lod < 0 or args.switch_index < 0:
        print("error: --lod and --switch must be >= 0; batch -1 is included automatically", file=sys.stderr)
        return 2

    output_dir = args.output_dir.expanduser().resolve()
    manifest_path = output_dir / f"{args.map_id}-geometry-poc.json"
    positions_path = output_dir / f"{args.map_id}-positions.f32le.bin"
    indices_path = output_dir / f"{args.map_id}-indices.u32le.bin"

    try:
        with zipfile.ZipFile(archive_path) as archive:
            scene_member = select_scene_member(archive, args.map_id)
            scg_member = select_companion_scg(archive, scene_member)
            scene_raw = archive.read(scene_member)
            scg_raw = archive.read(scg_member)

        scene_payload = (
            decode_dvpl(scene_raw)
            if normalize_member(scene_member.filename).lower().endswith(".dvpl")
            else scene_raw
        )
        scg_payload = (
            decode_dvpl(scg_raw)
            if normalize_member(scg_member.filename).lower().endswith(".dvpl")
            else scg_raw
        )
        scene = read_sc2(scene_payload)
        scg = read_scg(scg_payload)
        groups = [group for group in scg.get("polygonGroups", []) if isinstance(group, dict)]
        groups_by_id = polygon_groups_by_id(groups)

        instances, skipped = collect_instances(scene, args.lod, args.switch_index)
        if not instances:
            raise ExportMapGeometryError(
                f"no initially visible active Mesh batches for lod={args.lod}, "
                f"switch={args.switch_index}; skipped={dict(skipped.most_common())}"
            )

        required_ids = sorted({int(instance["datasourceId"]) for instance in instances})
        unmatched_ids = [identifier for identifier in required_ids if identifier not in groups_by_id]
        if unmatched_ids:
            raise ExportMapGeometryError(
                f"{len(unmatched_ids)} selected datasource ids are missing from companion SCG; "
                f"sample={unmatched_ids[:10]}"
            )

        output_dir.mkdir(parents=True, exist_ok=True)
        geometry_records, geometry_summary = write_geometry_buffers(
            groups_by_id, required_ids, positions_path, indices_path
        )

        manifest = {
            "schemaVersion": 3,
            "mapId": args.map_id,
            "source": {
                "sceneMember": normalize_member(scene_member.filename),
                "scgMember": normalize_member(scg_member.filename),
            },
            "selection": {
                "renderObjectClass": "Mesh",
                "requireInitialVisibility": True,
                "visibleFlag": RENDER_OBJECT_VISIBLE_FLAG,
                "visibleRule": (
                    "ro.flags bit 0 (DAVA RenderObject::VISIBLE) must be set; "
                    "missing ro.flags defaults to visible per RenderObject::Load"
                ),
                "lodIndex": args.lod,
                "switchIndex": args.switch_index,
                "sharedBatchIndex": SHARED_BATCH_INDEX,
                "activeRule": "batch index equals requested index or -1",
                "excludeShadowOnly": True,
            },
            "coordinateContract": {
                "geometrySpace": "DAVA local XYZ",
                "positionEncoding": "little-endian float32x3",
                "instanceTransform": "worldScale -> worldRotation(x,y,z,w) -> worldTranslation",
                "transformFields": [
                    "tc.worldScale",
                    "tc.worldRotation",
                    "tc.worldTranslation",
                ],
                "note": (
                    "Geometry is not baked into world space; renderers should instance each shared "
                    "geometry record using its SC2 world transform."
                ),
            },
            "buffers": {
                "positions": {
                    "file": positions_path.name,
                    "componentType": "float32",
                    "componentsPerVertex": 3,
                },
                "indices": {
                    "file": indices_path.name,
                    "componentType": "uint32",
                },
            },
            "geometrySummary": geometry_summary,
            "instanceSummary": {
                "count": len(instances),
                "uniqueDatasourceIds": len(required_ids),
                "skipped": dict(skipped.most_common()),
            },
            "geometry": geometry_records,
            "instances": instances,
            "evidenceRule": (
                "Positions are decoded from EVF_VERTEX at offset zero of the interleaved SCPG "
                "vertex stride; indices are decoded from PolygonGroup indexFormat. DAVA shared "
                "RenderBatch LOD/switch value -1 participates in every requested state. Initial "
                "RenderObject visibility follows the serialized DAVA VISIBLE bit, with missing "
                "ro.flags treated as visible according to RenderObject::Load. PolygonGroup #id "
                "values are validated as unique before datasource resolution. Instance transforms "
                "are preserved from SC2 TransformComponent world fields. Textures, materials, "
                "normals, tangents, UVs, vegetation, and gameplay collision are not exported by "
                "this PoC."
            ),
        }
        manifest_path.write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except (
        OSError,
        ValueError,
        zipfile.BadZipFile,
        Sc2ParseError,
        ExportMapGeometryError,
    ) as error:
        for path in (manifest_path, positions_path, indices_path):
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass
        print(f"error: {error}", file=sys.stderr)
        return 1

    print(
        f"geometry PoC: {geometry_summary['geometryCount']} shared groups, "
        f"{geometry_summary['totalDecodedPositions']} positions, "
        f"{geometry_summary['totalDecodedIndices']} indices, "
        f"{len(instances)} Mesh instances -> {manifest_path}"
    )
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
