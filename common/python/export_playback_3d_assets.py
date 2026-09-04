#!/usr/bin/env python3
"""Generate local-only derived 3D map assets for Battle Playback.

This wrapper keeps the user's client Maps.zip outside Git and reuses the proven
``export_map_geometry_poc.py`` contract from PR #247. Outputs are written to
``common/assets/map-3d-local`` because ``frontend/vite.config.js`` uses
``../common/assets`` as Vite's publicDir during local development.

In addition to static SCG geometry, the exporter derives the map's real tiled
uint16 heightmap into a renderer-neutral little-endian float32 height buffer.
No client textures/materials are copied.

IMPORTANT: output is intentionally LOCAL RESEARCH ONLY. It contains geometry and
terrain derived from user-supplied client resources and is not a production
asset pack. The frontend production build fails closed when this directory is
present so these files cannot be copied into ``dist`` accidentally.

Example:
    python common/python/export_playback_3d_assets.py \\
      "C:\\Users\\yu.chen\\Downloads\\Maps.zip" canal port
"""

from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import struct
import subprocess
import sys
import zipfile
from array import array

REPO = pathlib.Path(__file__).resolve().parents[2]
SEMANTICS_DIR = REPO / "common" / "map-semantics"
EXPORTER = REPO / "common" / "python" / "export_map_geometry_poc.py"
OUTPUT_DIR = REPO / "common" / "assets" / "map-3d-local"
LEGACY_OUTPUT_DIR = REPO / "frontend" / "public" / "map-3d-local"

sys.path.insert(0, str(REPO / "common" / "python"))
from wotb_sc2 import Sc2ParseError, decode_dvpl  # noqa: E402


class ExportPlayback3dError(RuntimeError):
    """Actionable local 3D export failure."""


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
    """Resolve a semantic source file inside one map directory.

    Semantic manifests preserve the client-relative path and may name either a
    raw resource or its ``.dvpl`` form. Local client archives can contain either,
    so exact lookup deliberately supports both without guessing by basename.
    """

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
    """Decode DAVA's tiled uint16 heightmap into row-major world Z meters.

    The tiling/scale contract matches ``map-semanticizer/load_heightmap`` which
    has already been validated against SC2 point Z coordinates.
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
        # Kept for local audit/debug only; never consumed as a production URL.
        "sourceMember": normalize_member(member.filename),
    }


def export_map(
    maps_zip: pathlib.Path,
    archive: zipfile.ZipFile,
    map_code: str,
    document: dict,
) -> dict:
    map_id = str(document["mapId"])
    command = [
        sys.executable,
        str(EXPORTER),
        str(maps_zip),
        map_id,
        "--output-dir",
        str(OUTPUT_DIR),
    ]
    subprocess.run(command, cwd=REPO, check=True)
    manifest_name = f"{map_id}-geometry-poc.json"
    manifest_path = OUTPUT_DIR / manifest_name
    if not manifest_path.is_file():
        raise ExportPlayback3dError(f"exporter did not create {manifest_path}")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("schemaVersion") != 3:
        raise ExportPlayback3dError(
            f"{map_code}: expected geometry schema 3, got {manifest.get('schemaVersion')}"
        )

    terrain = export_terrain(archive, map_code, document)
    semantic_terrain = document.get("terrain") or {}
    elevation = semantic_terrain.get("playableElevationMeters") or {}
    ground_z = elevation.get("median")
    return {
        "mapId": map_id,
        "displayName": document.get("displayName") or map_id,
        "manifest": f"/map-3d-local/{manifest_name}",
        "terrain": terrain,
        "referenceGroundZMeters": float(ground_z) if isinstance(ground_z, (int, float)) else 0.0,
        "geometryCount": manifest.get("geometrySummary", {}).get("geometryCount"),
        "instanceCount": manifest.get("instanceSummary", {}).get("count"),
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
        # PR #249 originally wrote here, but Vite never served it because
        # publicDir is ../common/assets. Remove stale files during migration.
        if LEGACY_OUTPUT_DIR.exists():
            shutil.rmtree(LEGACY_OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    index = {
        "schemaVersion": 3,
        "source": "LOCAL_CLIENT_DERIVED",
        "toolingPolicy": {
            "scope": "LOCAL_RESEARCH_ONLY",
            "productionEligible": False,
            "redistributionEnabled": False,
            "containsClientDerivedGeometry": True,
            "containsClientDerivedTerrain": True,
            "containsClientTextures": False,
            "containsClientMaterials": False,
        },
        "maps": {},
    }
    try:
        with zipfile.ZipFile(maps_zip) as archive:
            for code in args.map_codes:
                entry = export_map(maps_zip, archive, code, targets[code])
                index["maps"][code] = entry
                terrain = entry["terrain"]
                print(
                    f"{code} -> {entry['mapId']}: "
                    f"{entry['geometryCount']} geometry / {entry['instanceCount']} instances / "
                    f"terrain {terrain['samplesPerAxis']}x{terrain['samplesPerAxis']}"
                )
    except (
        OSError,
        subprocess.CalledProcessError,
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
    print(f"local Battle Playback 3D assets -> {index_path.relative_to(REPO)}")
    print("LOCAL RESEARCH ONLY: do not commit, publish, package, or redistribute generated map-3d-local assets.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
