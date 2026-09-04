"""Extract real vehicle hull dimensions from BlitzKit and regenerate the size table.

Battle Playback draws tank markers on a map whose scale is metres, so the
markers need real hull dimensions to avoid looking out of scale against the
terrain. The repository has no such data: the bundled
`frontend/src/vehicle-models/assets/*/metadata.json` only carries raster
logical coordinates, not metres.

BlitzKit's `definitions/models.pb` does. It is a `map<tankId, ModelDefinition>`
where the definition's field 6 is the hull axis-aligned bounding box in metres
(field 1 = min vec3, field 2 = max vec3, each vec3 being three float32s in
fields 1..3). The extents are, in order, width / hull length / height.

Validated against the Maus (tankId 6929): 3.72 x 8.98 x 1.86 m, matching the
real hull (3.67 m wide, ~9.0 m hull; the commonly quoted 10.2 m includes the
gun barrel).

The protobuf is read with the repository's existing schema-less decoder, so no
generated stubs or third-party runtime are needed.

Usage:
    python common/python/extract_vehicle_sizes.py
    python common/python/extract_vehicle_sizes.py --check
    python common/python/extract_vehicle_sizes.py --from-file models.pb
"""

from __future__ import annotations

import argparse
import json
import pathlib
import struct
import sys
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from update_tankopedia import decode_protobuf  # noqa: E402

REPO = pathlib.Path(__file__).resolve().parents[2]
OUTPUT = REPO / "frontend" / "src" / "data" / "vehicleSizes.js"
MODELS_URL = "https://api.blitzkit.app/definitions/models.pb"

BBOX_FIELD = 6
USER_AGENT = "WotbTools-vehicle-sizes/1"

# 消毒范围（米）：BlitzKit 的 bbox 已经是车体尺寸，越界值说明结构变了而不是出了辆怪车。
LENGTH_RANGE = (2.0, 16.0)
WIDTH_RANGE = (0.5, 8.0)


class ExtractError(RuntimeError):
    """An actionable input or consistency error."""


def fetch_models() -> bytes:
    request = urllib.request.Request(MODELS_URL, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def f32(value: int) -> float:
    return struct.unpack("<f", struct.pack("<I", value & 0xFFFFFFFF))[0]


def vec3(buf: bytes) -> tuple[float, float, float] | None:
    fields = decode_protobuf(buf)
    if not all(index in fields for index in (1, 2, 3)):
        return None
    return tuple(f32(fields[index][0]) for index in (1, 2, 3))  # type: ignore[return-value]


def hull_extent(definition: dict) -> tuple[float, float, float] | None:
    """(width, length, height) in metres from the hull bounding box."""
    if BBOX_FIELD not in definition:
        return None
    box = decode_protobuf(definition[BBOX_FIELD][0])
    low = vec3(box[1][0]) if 1 in box else None
    high = vec3(box[2][0]) if 2 in box else None
    if not low or not high:
        return None
    return tuple(high[axis] - low[axis] for axis in range(3))  # type: ignore[return-value]


def extract(models_pb: bytes) -> dict[int, tuple[float, float]]:
    root = decode_protobuf(models_pb)
    entries = root.get(1) or []
    if not entries:
        raise ExtractError("models.pb has no map entries in field 1 — structure changed")

    sizes: dict[int, tuple[float, float]] = {}
    skipped = 0
    for entry in entries:
        item = decode_protobuf(entry)
        if 1 not in item or 2 not in item:
            skipped += 1
            continue
        tank_id = item[1][0]
        extent = hull_extent(decode_protobuf(item[2][0]))
        if extent is None:
            skipped += 1
            continue
        width, length, _height = extent
        if not (LENGTH_RANGE[0] <= length <= LENGTH_RANGE[1]):
            raise ExtractError(f"tank {tank_id}: hull length {length:.2f} m out of range")
        if not (WIDTH_RANGE[0] <= width <= WIDTH_RANGE[1]):
            raise ExtractError(f"tank {tank_id}: hull width {width:.2f} m out of range")
        sizes[tank_id] = (round(length, 3), round(width, 3))

    if len(sizes) < 500:
        raise ExtractError(f"only {len(sizes)} vehicles extracted ({skipped} skipped) — expected 700+")
    return sizes


def render_js(sizes: dict[int, tuple[float, float]]) -> str:
    lines = [
        "// GENERATED FILE — do not edit by hand.",
        "// Regenerate: python common/python/extract_vehicle_sizes.py",
        "// See docs/features/battle-playback.md for how the map consumes it.",
        "",
        "/**",
        " * 车体实际尺寸（米），来源 BlitzKit `definitions/models.pb` 的车体包围盒。",
        " * key 为回放里的 `tankId`；值为 `[车体长, 车体宽]`——不含炮管。",
        " * 地图按米制缩放车辆标记，缺失 tankId 的车走 DEFAULT_VEHICLE_LENGTH_M 兜底。",
        " */",
        "export const vehicleSizes = {",
    ]
    for tank_id, (length, width) in sorted(sizes.items()):
        lines.append(f"  {tank_id}: [{length}, {width}],")
    lines.append("}")
    lines.append("")
    lines.append("/** 无尺寸数据时的车体长（米）：全表中位数，量级不会明显失真。 */")
    median = sorted(length for length, _ in sizes.values())[len(sizes) // 2]
    lines.append(f"export const DEFAULT_VEHICLE_LENGTH_M = {round(median, 3)}")
    lines.append("")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--check", action="store_true",
                        help="Fail if the generated file would change; write nothing")
    parser.add_argument("--from-file", type=pathlib.Path,
                        help="Read models.pb from disk instead of fetching it")
    args = parser.parse_args()

    try:
        models_pb = args.from_file.read_bytes() if args.from_file else fetch_models()
        sizes = extract(models_pb)
    except (ExtractError, OSError) as error:
        print(f"{error}", file=sys.stderr)
        return 1

    rendered = render_js(sizes)
    if args.check:
        current = OUTPUT.read_text(encoding="utf-8") if OUTPUT.exists() else ""
        if current != rendered:
            print(f"{OUTPUT.relative_to(REPO)} is stale — rerun without --check", file=sys.stderr)
            return 1
        print(f"{OUTPUT.relative_to(REPO)} is up to date ({len(sizes)} vehicles)")
        return 0

    OUTPUT.write_text(rendered, encoding="utf-8", newline="\n")
    lengths = sorted(length for length, _ in sizes.values())
    print(f"{OUTPUT.relative_to(REPO)}: {len(sizes)} vehicles, "
          f"hull length {lengths[0]:.2f}–{lengths[-1]:.2f} m "
          f"(median {lengths[len(lengths) // 2]:.2f} m)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
