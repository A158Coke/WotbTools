#!/usr/bin/env python3
"""Generate local-only derived 3D map assets for Battle Playback.

This wrapper keeps the user's client Maps.zip outside Git and reuses the proven
``export_map_geometry_poc.py`` contract from PR #247. Outputs are written to
``frontend/public/map-3d-local`` so Vite can serve them during local testing.

Example:
    python common/python/export_playback_3d_assets.py \
      "C:\\Users\\yu.chen\\Downloads\\Maps.zip" canal port
"""

from __future__ import annotations

import argparse
import json
import pathlib
import shutil
import subprocess
import sys

REPO = pathlib.Path(__file__).resolve().parents[2]
SEMANTICS_DIR = REPO / "common" / "map-semantics"
EXPORTER = REPO / "common" / "python" / "export_map_geometry_poc.py"
OUTPUT_DIR = REPO / "frontend" / "public" / "map-3d-local"


class ExportPlayback3dError(RuntimeError):
    """Actionable local 3D export failure."""


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


def export_map(maps_zip: pathlib.Path, map_code: str, document: dict) -> dict:
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
    terrain = document.get("terrain") or {}
    elevation = terrain.get("playableElevationMeters") or {}
    ground_z = elevation.get("median")
    return {
        "mapId": map_id,
        "displayName": document.get("displayName") or map_id,
        "manifest": f"/map-3d-local/{manifest_name}",
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

    if args.clean and OUTPUT_DIR.exists():
        shutil.rmtree(OUTPUT_DIR)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    index = {
        "schemaVersion": 1,
        "source": "LOCAL_CLIENT_DERIVED",
        "maps": {},
    }
    try:
        for code in args.map_codes:
            entry = export_map(maps_zip, code, targets[code])
            index["maps"][code] = entry
            print(
                f"{code} -> {entry['mapId']}: "
                f"{entry['geometryCount']} geometry / {entry['instanceCount']} instances"
            )
    except (OSError, subprocess.CalledProcessError, ExportPlayback3dError, json.JSONDecodeError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    index_path = OUTPUT_DIR / "index.json"
    index_path.write_text(
        json.dumps(index, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"local Battle Playback 3D assets -> {index_path.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
