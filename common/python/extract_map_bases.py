"""Extract base (capture point) geometry from the game client map scenes.

Reads `Maps.zip` (or an unpacked `Maps/` directory) from the WoT Blitz client,
pulls the capture-point entities out of each `*.sc2` scene and regenerates
`frontend/src/data/mapBases.js`.

Two entity types carry base geometry:

  strategicpoint  Supremacy (争霸赛). 3-4 per map, each with a `baseID` 0..3 that
                  matches `SupremacyBaseId.fromProtocolIndex()` on the backend,
                  so it maps straight onto the `baseStates` wire field.
  controlpoint    Encounter / Assault (攻防战). One base per mode configuration,
                  `team` marks the defending side. Radius is larger than a
                  Supremacy base where the scene declares one.

Coordinates are world meters on the same axes as replay positions and as
`coordinateSystem.worldBounds` in `common/map-semantics/*.semantic.json`
(x = map horizontal, y = map vertical). They render directly against the
basemaps registered in `frontend/src/data/mapImages.js`, whose frame is the
same world extent.

Usage:
    python common/python/extract_map_bases.py <Maps.zip|Maps dir>
    python common/python/extract_map_bases.py <input> --check
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
import zipfile
from typing import Any, Iterator

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from wotb_sc2 import (  # noqa: E402
    Sc2ParseError,
    decode_dvpl,
    entity_position,
    entity_properties,
    read_sc2,
    scene_entities,
)

REPO = pathlib.Path(__file__).resolve().parents[2]
SEMANTICS_DIR = REPO / "common" / "map-semantics"
MAP_IMAGES = REPO / "frontend" / "src" / "data" / "mapImages.js"
OUTPUT = REPO / "frontend" / "src" / "data" / "mapBases.js"

SUPREMACY_BASE_IDS = ["A", "B", "C", "D"]


class ExtractError(RuntimeError):
    """An actionable input or consistency error."""


def registered_map_codes() -> list[str]:
    """mapCode keys registered in mapImages.js — the set we emit bases for."""
    source = MAP_IMAGES.read_text(encoding="utf-8")
    body = source[source.index("export const mapImages"):]
    return re.findall(r"^  (\w+):", body, re.M)


def scene_ids_by_map_code() -> dict[str, str]:
    """mapCode -> semantic mapId (which is also the client scene directory)."""
    result: dict[str, str] = {}
    for path in sorted(SEMANTICS_DIR.glob("*.semantic.json")):
        document = json.loads(path.read_text(encoding="utf-8"))
        for code in document.get("mapCodes") or []:
            result[code] = document["mapId"]
    return result


class SceneSource:
    """Reads `<mapId>/<mapId>.sc2.dvpl` from a zip or an unpacked directory."""

    def __init__(self, root: pathlib.Path) -> None:
        self.root = root
        self.zip = zipfile.ZipFile(root) if root.suffix.lower() == ".zip" else None
        if self.zip is not None:
            self.names = set(self.zip.namelist())

    def read(self, map_id: str) -> bytes | None:
        relative = f"{map_id}/{map_id}.sc2.dvpl"
        if self.zip is not None:
            for candidate in (f"Maps/{relative}", relative):
                if candidate in self.names:
                    return self.zip.read(candidate)
            return None
        for candidate in (self.root / relative, self.root / "Maps" / relative):
            if candidate.exists():
                return candidate.read_bytes()
        return None


def capture_points(raw: bytes) -> Iterator[tuple[str, dict[str, Any], tuple[float, float, float]]]:
    for entity in scene_entities(read_sc2(decode_dvpl(raw))):
        properties = entity_properties(entity)
        point_type = properties.get("type")
        if point_type not in ("strategicpoint", "controlpoint"):
            continue
        position = entity_position(entity)
        if position is None:
            continue
        yield str(point_type), properties, position


def round4(value: float) -> float:
    return round(float(value), 4)


def extract_map(raw: bytes, map_code: str) -> dict[str, Any]:
    supremacy: list[dict[str, Any]] = []
    assault: list[dict[str, Any]] = []
    for point_type, properties, (x, y, _z) in capture_points(raw):
        radius = properties.get("radius")
        if point_type == "strategicpoint":
            index = properties.get("baseID")
            if not isinstance(index, int) or not 0 <= index < len(SUPREMACY_BASE_IDS):
                raise ExtractError(f"{map_code}: strategicpoint has unusable baseID {index!r}")
            supremacy.append({
                "baseId": SUPREMACY_BASE_IDS[index],
                "x": round4(x),
                "y": round4(y),
                "radius": round4(radius) if radius is not None else None,
            })
        else:
            assault.append({
                "x": round4(x),
                "y": round4(y),
                "radius": round4(radius) if radius is not None else None,
                "team": properties.get("team"),
            })

    supremacy.sort(key=lambda base: base["baseId"])
    seen = [base["baseId"] for base in supremacy]
    if len(seen) != len(set(seen)):
        raise ExtractError(f"{map_code}: duplicate Supremacy baseId in {seen}")
    if seen and seen != SUPREMACY_BASE_IDS[:len(seen)]:
        raise ExtractError(f"{map_code}: Supremacy baseIds are not contiguous from A: {seen}")

    assault.sort(key=lambda base: (base["x"], base["y"]))
    return {"supremacy": supremacy, "assault": assault}


def render_js(data: dict[str, dict[str, Any]], source_name: str) -> str:
    def base_line(base: dict[str, Any]) -> str:
        fields = ", ".join(
            f"{key}: {'null' if value is None else json.dumps(value)}"
            for key, value in base.items()
        )
        return "{ " + fields + " }"

    lines = [
        "// GENERATED FILE — do not edit by hand.",
        f"// Regenerate: python common/python/extract_map_bases.py <{source_name}>",
        "// See docs/reference/maps.md for the extraction contract.",
        "",
        "/**",
        " * 基地（占领点）几何，来源为客户端地图场景 `*.sc2`，世界坐标（米），",
        " * 与回放坐标、`mapImages.js` 的 `coordinateBounds` 同一坐标系。",
        " *",
        " * supremacy 争霸赛：3-4 个基地，`baseId` 由场景 `baseID` 0..3 而来，",
        " *   与后端 `SupremacyBaseId.fromProtocolIndex()` 及 wire 字段 `baseStates[].baseId` 同源。",
        " * assault 攻防战/遭遇战：每种模式配置一个基地，`team` 为守方；",
        " *   场景未声明半径时为 null，调用方自行取默认值。",
        " */",
        "export const mapBases = {",
    ]
    for map_code, entry in sorted(data.items()):
        lines.append(f"  {map_code}: {{")
        for group in ("supremacy", "assault"):
            bases = entry[group]
            if not bases:
                lines.append(f"    {group}: [],")
                continue
            lines.append(f"    {group}: [")
            for base in bases:
                lines.append(f"      {base_line(base)},")
            lines.append("    ],")
        lines.append("  },")
    lines.append("}")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("input", type=pathlib.Path, help="Maps.zip or an unpacked Maps directory")
    parser.add_argument("--check", action="store_true",
                        help="Fail if the generated file would change; write nothing")
    args = parser.parse_args()

    if not args.input.exists():
        print(f"input not found: {args.input}", file=sys.stderr)
        return 2

    source = SceneSource(args.input)
    scene_ids = scene_ids_by_map_code()
    data: dict[str, dict[str, Any]] = {}
    missing: list[str] = []

    for map_code in registered_map_codes():
        map_id = scene_ids.get(map_code)
        raw = source.read(map_id) if map_id else None
        if raw is None:
            missing.append(map_code)
            continue
        try:
            data[map_code] = extract_map(raw, map_code)
        except (Sc2ParseError, ExtractError) as error:
            print(f"{map_code}: {error}", file=sys.stderr)
            return 1

    if missing:
        print(f"no scene for: {', '.join(missing)}", file=sys.stderr)
        return 1

    rendered = render_js(data, args.input.name)
    if args.check:
        current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
        if current != rendered:
            print(f"{OUTPUT.relative_to(REPO)} is stale — rerun without --check", file=sys.stderr)
            return 1
        print(f"{OUTPUT.relative_to(REPO)} is up to date ({len(data)} maps)")
        return 0

    OUTPUT.write_text(rendered, encoding="utf-8", newline="\n")
    supremacy = sum(len(entry["supremacy"]) for entry in data.values())
    assault = sum(len(entry["assault"]) for entry in data.values())
    print(f"{OUTPUT.relative_to(REPO)}: {len(data)} maps, "
          f"{supremacy} Supremacy bases, {assault} Assault bases")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
