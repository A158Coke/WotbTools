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
import struct
import sys
import zipfile
from collections import Counter
from typing import Any, Iterator

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from wotb_sc2 import Sc2ParseError, decode_dvpl, entity_components, read_sc2  # noqa: E402
from wotb_scg import (  # noqa: E402
    decode_polygon_indices,
    decode_polygon_positions,
    polygon_group_vertex_stride,
    polygon_groups_by_id,
    position_aabb,
    read_scg,
)

SHARED_BATCH_INDEX = -1
RENDER_OBJECT_VISIBLE_FLAG = 1 << 0


class ExportMapGeometryError(RuntimeError):
    """Actionable map-geometry export error."""


def normalize_member(name: str) -> str:
    return name.replace("\\", "/").lstrip("/")


def archive_files(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    return [info for info in archive.infolist() if not info.is_dir()]


def select_scene_member(archive: zipfile.ZipFile, map_id: str) -> zipfile.ZipInfo:
    by_name = {
        normalize_member(info.filename).lower(): info
        for info in archive_files(archive)
    }
    for candidate in (
        f"Maps/{map_id}/{map_id}.sc2.dvpl",
        f"{map_id}/{map_id}.sc2.dvpl",
        f"Maps/{map_id}/{map_id}.sc2",
        f"{map_id}/{map_id}.sc2",
    ):
        match = by_name.get(candidate.lower())
        if match is not None:
            return match
    raise ExportMapGeometryError(f"main SC2 not found for map: {map_id}")


def select_companion_scg(
    archive: zipfile.ZipFile,
    scene_member: zipfile.ZipInfo,
) -> zipfile.ZipInfo:
    scene_name = normalize_member(scene_member.filename)
    lower = scene_name.lower()
    if lower.endswith(".sc2.dvpl"):
        candidates = (scene_name[:-9] + ".scg.dvpl", scene_name[:-9] + ".scg")
    elif lower.endswith(".sc2"):
        candidates = (scene_name[:-4] + ".scg", scene_name[:-4] + ".scg.dvpl")
    else:
        candidates = ()

    by_name = {
        normalize_member(info.filename).lower(): info
        for info in archive_files(archive)
    }
    for candidate in candidates:
        match = by_name.get(candidate.lower())
        if match is not None:
            return match
    raise ExportMapGeometryError(
        f"companion SCG not found for main scene: {scene_name}"
    )


def iter_entities_recursive(
    container: dict[str, Any], path: str = "$"
) -> Iterator[tuple[str, dict[str, Any]]]:
    """Yield all SC2 entities, including nested ``#hierarchy`` children."""

    hierarchy = container.get("#hierarchy")
    if not isinstance(hierarchy, list):
        return
    for index, entity in enumerate(hierarchy):
        if not isinstance(entity, dict):
            continue
        entity_path = f"{path}.#hierarchy[{index}]"
        yield entity_path, entity
        yield from iter_entities_recursive(entity, entity_path)


def component_by_type(
    entity: dict[str, Any], type_name: str
) -> dict[str, Any] | None:
    return next(
        (
            component
            for component in entity_components(entity)
            if component.get("comp.typename") == type_name
        ),
        None,
    )


def vector(
    component: dict[str, Any] | None,
    key: str,
    size: int,
    default: tuple[float, ...],
) -> list[float]:
    if component is None:
        return list(default)
    value = component.get(key)
    if not isinstance(value, list) or len(value) != size:
        return list(default)
    return [float(item) for item in value]


def world_transform(entity: dict[str, Any]) -> dict[str, list[float]]:
    transform = component_by_type(entity, "TransformComponent")
    return {
        "translation": vector(
            transform, "tc.worldTranslation", 3, (0.0, 0.0, 0.0)
        ),
        "scale": vector(transform, "tc.worldScale", 3, (1.0, 1.0, 1.0)),
        "rotationQuaternionXYZW": vector(
            transform, "tc.worldRotation", 4, (0.0, 0.0, 0.0, 1.0)
        ),
    }


def iter_render_batches(
    render_object: dict[str, Any],
) -> Iterator[tuple[int, dict[str, Any]]]:
    """Yield batch index + archive while preserving DAVA GenKeyFromIndex ids."""

    batches = render_object.get("ro.batches")
    if isinstance(batches, dict):
        for raw_index, batch in batches.items():
            if not isinstance(batch, dict):
                continue
            text = str(raw_index)
            if not text.isdigit():
                raise ExportMapGeometryError(
                    f"RenderObject has non-numeric ro.batches key {raw_index!r}"
                )
            yield int(text), batch
    elif isinstance(batches, list):
        for index, batch in enumerate(batches):
            if isinstance(batch, dict):
                yield index, batch


def batch_option(render_object: dict[str, Any], batch_index: int, name: str) -> int:
    """Read DAVA batch option; SceneFileV2 load defaults missing values to -1."""

    value = render_object.get(f"rb{batch_index}.{name}", SHARED_BATCH_INDEX)
    if not isinstance(value, int):
        raise ExportMapGeometryError(
            f"RenderObject rb{batch_index}.{name} must be int, got {type(value).__name__}"
        )
    return value


def batch_is_active(batch_index: int, requested_index: int) -> bool:
    """Mirror RenderObject::UpdateActiveRenderBatchesFromCollection."""

    return batch_index == requested_index or batch_index == SHARED_BATCH_INDEX


def render_object_is_visible(render_object: dict[str, Any]) -> bool:
    """Mirror the serialized DAVA RenderObject VISIBLE flag for initial state.

    RenderObject::Load defaults a missing ``ro.flags`` field to its serialization
    criteria, which includes VISIBLE. Therefore absence means visible; an
    explicit flags value must be an integer and bit 0 controls visibility.
    """

    flags = render_object.get("ro.flags")
    if flags is None:
        return True
    if not isinstance(flags, int):
        raise ExportMapGeometryError(
            f"RenderObject ro.flags must be int, got {type(flags).__name__}"
        )
    return (flags & RENDER_OBJECT_VISIBLE_FLAG) == RENDER_OBJECT_VISIBLE_FLAG


def collect_instances(
    scene: dict[str, Any],
    target_lod: int,
    target_switch: int,
) -> tuple[list[dict[str, Any]], Counter[str]]:
    """Collect initially visible active Mesh batches without baking transforms."""

    instances: list[dict[str, Any]] = []
    skipped: Counter[str] = Counter()
    seen: set[tuple[str, int, int]] = set()

    for entity_path, entity in iter_entities_recursive(scene):
        render = component_by_type(entity, "RenderComponent")
        if render is None:
            continue
        render_object = render.get("rc.renderObj")
        if not isinstance(render_object, dict):
            skipped["render_object_missing"] += 1
            continue
        render_class = str(render_object.get("##name", "<unknown>"))
        if render_class != "Mesh":
            skipped[f"render_class:{render_class}"] += 1
            continue
        if not render_object_is_visible(render_object):
            skipped["invisible_render_object"] += 1
            continue
        if render_object.get("ro.notShadowOnly") is False:
            skipped["shadow_only"] += 1
            continue

        entity_name = entity.get("name")
        transform = world_transform(entity)
        for batch_index, batch in iter_render_batches(render_object):
            datasource = batch.get("rb.datasource")
            if not isinstance(datasource, int):
                skipped["batch_without_datasource"] += 1
                continue

            lod_index = batch_option(render_object, batch_index, "lodIndex")
            switch_index = batch_option(render_object, batch_index, "switchIndex")
            if not batch_is_active(lod_index, target_lod):
                skipped["inactive_lod"] += 1
                continue
            if not batch_is_active(switch_index, target_switch):
                skipped["inactive_switch"] += 1
                continue

            signature = (entity_path, datasource, batch_index)
            if signature in seen:
                skipped["duplicate_signature"] += 1
                continue
            seen.add(signature)
            instances.append(
                {
                    "entityPath": entity_path,
                    "entityName": entity_name if isinstance(entity_name, str) else None,
                    "datasourceId": datasource,
                    "datasourceIdHex": f"0x{datasource:016x}",
                    "batchIndex": batch_index,
                    "lodIndex": lod_index,
                    "switchIndex": switch_index,
                    "worldTransform": transform,
                }
            )

    return instances, skipped


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
