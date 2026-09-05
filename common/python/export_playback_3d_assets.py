#!/usr/bin/env python3
"""Generate local-only 2.5D terrain facts for Battle Playback.

The prototype deliberately does *not* reconstruct the client 3D scene. It keeps
only the already-proven tiled heightfield plus optional numeric Water Z facts so
the frontend can shade the existing 2D tactical map from a fixed top-down view.
No SCG geometry, client meshes, textures, materials, or shaders are exported.

Outputs are written to ``common/assets/map-3d-local`` because
``frontend/vite.config.js`` uses ``../common/assets`` as Vite's publicDir during
local development.

IMPORTANT: output is intentionally LOCAL RESEARCH ONLY. The heightfield is still
derived from user-supplied client resources. The frontend production build fails
closed when this directory exists so these files cannot be copied into ``dist``
accidentally.

Example:
    python common/python/export_playback_3d_assets.py \\
      "C:\\Users\\yu.chen\\Downloads\\Maps.zip" canal port --clean
"""

from __future__ import annotations

import argparse
import json
import math
import pathlib
import shutil
import struct
import sys
import zipfile
from array import array
from typing import Any

REPO = pathlib.Path(__file__).resolve().parents[2]
SEMANTICS_DIR = REPO / "common" / "map-semantics"
OUTPUT_DIR = REPO / "common" / "assets" / "map-3d-local"
LEGACY_OUTPUT_DIR = REPO / "frontend" / "public" / "map-3d-local"

sys.path.insert(0, str(REPO / "common" / "python"))
from export_map_geometry_poc import (  # noqa: E402
    component_by_type,
    iter_entities_recursive,
    render_object_is_visible,
    select_scene_member,
    world_transform,
)
from wotb_sc2 import Sc2ParseError, decode_bytes, decode_dvpl, read_sc2  # noqa: E402


class ExportPlayback3dError(RuntimeError):
    """Actionable local 2.5D export failure."""


WATER_LOCAL_Z_SPAN_TOLERANCE_METERS = 0.25
WATER_XY_TILT_QUATERNION_TOLERANCE = 1e-4


def normalize_member(name: str) -> str:
    return name.replace("\\", "/").lstrip("/")


def semantic_targets() -> dict[str, dict]:
    result: dict[str, dict] = {}
    for path in sorted(SEMANTICS_DIR.glob("*.semantic.json")):
        document = json.loads(path.read_text(encoding="utf-8"))
        map_id = document.get("mapId")
        if not isinstance(map_id, str):
            continue
        for code in document.get("mapCodes") or []:
            if isinstance(code, str) and code:
                result[code] = document
    return result


def resource_name_variants(name: str) -> list[str]:
    normalized = normalize_member(name)
    variants = [normalized]
    if normalized.lower().endswith(".dvpl"):
        variants.append(normalized[:-5])
    else:
        variants.append(normalized + ".dvpl")
    return variants


def select_map_resource(
    archive: zipfile.ZipFile,
    map_id: str,
    relative_name: str,
) -> zipfile.ZipInfo:
    """Resolve one semantic source resource inside exactly one map directory."""

    by_name = {
        normalize_member(info.filename).lower(): info
        for info in archive.infolist()
        if not info.is_dir()
    }
    for relative in resource_name_variants(relative_name):
        for candidate in (
            f"Maps/{map_id}/{relative}",
            f"{map_id}/{relative}",
        ):
            match = by_name.get(candidate.lower())
            if match is not None:
                return match
    raise ExportPlayback3dError(
        f"map resource not found: map={map_id}, source={relative_name}"
    )


def decode_resource(raw: bytes, member_name: str) -> bytes:
    return decode_dvpl(raw) if normalize_member(member_name).lower().endswith(".dvpl") else raw


def decode_heightmap(
    raw: bytes,
    world_bounds: dict,
) -> tuple[int, int, list[float]]:
    """Decode DAVA tiled uint16 height samples into row-major world-Z meters.

    The tiling/scale contract matches ``map-semanticizer/load_heightmap`` and was
    previously validated against SC2 point-Z coordinates. Keeping this exact
    sample grid avoids inventing terrain geometry; the frontend only connects
    adjacent samples to shade the existing 2D map.
    """

    if len(raw) < 8:
        raise ExportPlayback3dError("heightmap is too small")
    size, tile_size = struct.unpack_from("<II", raw)
    if tile_size <= 0 or size <= 0 or size % tile_size:
        raise ExportPlayback3dError(
            f"unexpected heightmap header: size={size}, tile={tile_size}"
        )
    expected_bytes = 8 + size * size * 2
    if len(raw) != expected_bytes:
        raise ExportPlayback3dError(
            f"unexpected heightmap size: expected={expected_bytes}, actual={len(raw)}"
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
                row = values[source_index:source_index + tile_size]
                untiled[destination:destination + tile_size] = row.tolist()
                source_index += tile_size

    try:
        z_min = float(world_bounds["zMin"])
        z_max = float(world_bounds["zMax"])
    except (KeyError, TypeError, ValueError) as error:
        raise ExportPlayback3dError("semantic world bounds are missing zMin/zMax") from error
    z_scale = (z_max - z_min) / 65535.0
    heights = [z_min + value * z_scale for value in untiled]
    return size, tile_size, heights


def write_float32_le(path: pathlib.Path, values: list[float]) -> None:
    payload = array("f", values)
    if sys.byteorder != "little":
        payload.byteswap()
    path.write_bytes(payload.tobytes())


def export_terrain(
    archive: zipfile.ZipFile,
    map_code: str,
    document: dict,
) -> dict:
    map_id = str(document["mapId"])
    source_files = document.get("sourceFiles") or {}
    heightmap_name = source_files.get("heightmap")
    coordinate_system = document.get("coordinateSystem") or {}
    world_bounds = coordinate_system.get("worldBounds") or {}
    if not isinstance(heightmap_name, str) or not heightmap_name:
        raise ExportPlayback3dError(f"{map_code}: semantic heightmap source is missing")

    member = select_map_resource(archive, map_id, heightmap_name)
    payload = decode_resource(archive.read(member), member.filename)
    size, tile_size, heights = decode_heightmap(payload, world_bounds)

    terrain_name = f"{map_id}-terrain.f32le.bin"
    write_float32_le(OUTPUT_DIR / terrain_name, heights)

    try:
        x_min = float(world_bounds["xMin"])
        y_min = float(world_bounds["yMin"])
        x_max = float(world_bounds["xMax"])
        y_max = float(world_bounds["yMax"])
    except (KeyError, TypeError, ValueError) as error:
        raise ExportPlayback3dError(
            f"{map_code}: semantic world bounds are missing x/y limits"
        ) from error

    return {
        "heightBuffer": f"/map-3d-local/{terrain_name}",
        "encoding": "float32le-world-z-meters",
        "samplesPerAxis": size,
        "storageTileSize": tile_size,
        "sampleSpacingMeters": {
            "x": (x_max - x_min) / size,
            "y": (y_max - y_min) / size,
        },
        "worldBounds": {
            "xMin": x_min,
            "yMin": y_min,
            "zMin": float(world_bounds.get("zMin", min(heights))),
            "xMax": x_max,
            "yMax": y_max,
            "zMax": float(world_bounds.get("zMax", max(heights))),
        },
        "heightRangeMeters": {
            "min": min(heights),
            "max": max(heights),
        },
        # Local audit fact only; not a production URL or redistributed resource.
        "sourceMember": normalize_member(member.filename),
    }


def decode_render_bbox(render_object: dict[str, Any]) -> tuple[float, float, float, float, float, float] | None:
    payload = decode_bytes(render_object.get("bbox"))
    if payload is None:
        return None
    if len(payload) != 24:
        raise ExportPlayback3dError(
            f"Water RenderObject bbox has {len(payload)} bytes, expected 24"
        )
    return tuple(float(value) for value in struct.unpack("<6f", payload))


def extract_procedural_water_planes(scene: dict[str, Any]) -> list[dict[str, Any]]:
    """Return numeric horizontal Water Z facts without exporting water geometry."""

    candidates: list[dict[str, Any]] = []
    for entity_path, entity in iter_entities_recursive(scene):
        render = component_by_type(entity, "RenderComponent")
        if render is None:
            continue
        render_object = render.get("rc.renderObj")
        if not isinstance(render_object, dict):
            continue
        if str(render_object.get("##name", "")) != "Water":
            continue
        if not render_object_is_visible(render_object):
            continue

        bbox = decode_render_bbox(render_object)
        if bbox is None:
            continue
        local_z_min, local_z_max = bbox[2], bbox[5]
        local_z_span = abs(local_z_max - local_z_min)
        if local_z_span > WATER_LOCAL_Z_SPAN_TOLERANCE_METERS:
            continue

        transform = world_transform(entity)
        translation = transform.get("translation") or [0.0, 0.0, 0.0]
        scale = transform.get("scale") or [1.0, 1.0, 1.0]
        quaternion = transform.get("rotationQuaternionXYZW") or [0.0, 0.0, 0.0, 1.0]
        if len(translation) != 3 or len(scale) != 3 or len(quaternion) != 4:
            continue
        if abs(float(quaternion[0])) > WATER_XY_TILT_QUATERNION_TOLERANCE:
            continue
        if abs(float(quaternion[1])) > WATER_XY_TILT_QUATERNION_TOLERANCE:
            continue

        local_surface_z = (local_z_min + local_z_max) / 2.0
        world_z = float(translation[2]) + local_surface_z * float(scale[2])
        if not math.isfinite(world_z):
            continue
        candidates.append({
            "zMeters": round(world_z, 4),
            "evidence": "WATER_FLAT_BBOX_Z_PLUS_SC2_WORLD_TRANSFORM",
            "localZSpanMeters": round(local_z_span, 6),
            # Kept only for local debugging; no geometry is exported.
            "entityPath": entity_path,
        })

    result: list[dict[str, Any]] = []
    for candidate in sorted(candidates, key=lambda item: float(item["zMeters"])):
        if result and abs(float(candidate["zMeters"]) - float(result[-1]["zMeters"])) < 0.01:
            continue
        result.append(candidate)
    return result


def export_water(archive: zipfile.ZipFile, map_id: str) -> dict[str, Any]:
    scene_member = select_scene_member(archive, map_id)
    scene = read_sc2(decode_resource(archive.read(scene_member), scene_member.filename))
    return {
        "renderMode": "NUMERIC_Z_FACTS_ONLY",
        "planes": extract_procedural_water_planes(scene),
        "usesClientWaterGeometry": False,
        "usesClientTextures": False,
        "usesClientMaterials": False,
        "usesClientShaders": False,
        "sourceMember": normalize_member(scene_member.filename),
    }


def export_map(
    archive: zipfile.ZipFile,
    map_code: str,
    document: dict,
) -> dict:
    map_id = str(document["mapId"])
    terrain = export_terrain(archive, map_code, document)
    water = export_water(archive, map_id)
    semantic_terrain = document.get("terrain") or {}
    elevation = semantic_terrain.get("playableElevationMeters") or {}
    ground_z = elevation.get("median")
    return {
        "mapId": map_id,
        "displayName": document.get("displayName") or map_id,
        "renderMode": "TOP_DOWN_2_5D_HEIGHTFIELD",
        "terrain": terrain,
        "water": water,
        "referenceGroundZMeters": float(ground_z) if isinstance(ground_z, (int, float)) else 0.0,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("maps_zip", type=pathlib.Path, help="Path to client Maps.zip")
    parser.add_argument(
        "map_codes",
        nargs="+",
        help="Replay mapCode values, e.g. canal port",
    )
    parser.add_argument(
        "--clean",
        action="store_true",
        help="Delete existing local derived assets before exporting",
    )
    args = parser.parse_args()

    maps_zip = args.maps_zip.expanduser().resolve()
    if not maps_zip.is_file():
        print(f"error: Maps.zip not found: {maps_zip}", file=sys.stderr)
        return 2

    targets = semantic_targets()
    unknown = [code for code in args.map_codes if code not in targets]
    if unknown:
        print(
            f"error: no semantic mapId for mapCode(s): {', '.join(unknown)}",
            file=sys.stderr,
        )
        return 2

    if args.clean:
        if OUTPUT_DIR.exists():
            shutil.rmtree(OUTPUT_DIR)
        if LEGACY_OUTPUT_DIR.exists():
            shutil.rmtree(LEGACY_OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    index = {
        "schemaVersion": 5,
        "source": "LOCAL_CLIENT_DERIVED_HEIGHTFIELD",
        "renderMode": "TOP_DOWN_2_5D_HEIGHTFIELD",
        "toolingPolicy": {
            "scope": "LOCAL_RESEARCH_ONLY",
            "productionEligible": False,
            "redistributionEnabled": False,
            "containsClientDerivedGeometry": False,
            "containsClientDerivedTerrain": True,
            "containsClientTextures": False,
            "containsClientMaterials": False,
            "containsClientWaterGeometry": False,
        },
        "maps": {},
    }

    try:
        with zipfile.ZipFile(maps_zip) as archive:
            for code in args.map_codes:
                entry = export_map(archive, code, targets[code])
                index["maps"][code] = entry
                terrain = entry["terrain"]
                water_planes = entry.get("water", {}).get("planes", [])
                water_text = ", ".join(str(plane["zMeters"]) for plane in water_planes) or "none"
                print(
                    f"{code} -> {entry['mapId']}: "
                    f"2.5D terrain {terrain['samplesPerAxis']}x{terrain['samplesPerAxis']} / "
                    f"water Z={water_text} / static geometry=disabled"
                )
    except (
        OSError,
        ExportPlayback3dError,
        Sc2ParseError,
        json.JSONDecodeError,
        zipfile.BadZipFile,
    ) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    index_path = OUTPUT_DIR / "index.json"
    index_path.write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"local Battle Playback 2.5D assets -> {index_path.relative_to(REPO)}")
    print("LOCAL RESEARCH ONLY: do not commit, publish, package, or redistribute generated map-3d-local assets.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
