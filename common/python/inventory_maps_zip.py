#!/usr/bin/env python3
"""Inventory a WoT Blitz Maps.zip without unpacking the whole archive.

The report is deliberately evidence-only: filename/path patterns are grouped as
*candidates* until the underlying resource format is decoded and validated.

Examples:
    python common/python/inventory_maps_zip.py C:\\path\\to\\Maps.zip
    python common/python/inventory_maps_zip.py C:\\path\\to\\Maps.zip --extract-map 05_amigosville_am
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
import zipfile
from collections import Counter, defaultdict
from typing import Any

MAP_ID_RE = re.compile(r"^\d{2}_[a-z0-9_]+$", re.IGNORECASE)

CANDIDATE_TOKENS: dict[str, tuple[str, ...]] = {
    "scene": (".sc2",),
    "heightmap": ("heightmap",),
    "geometry": (".mesh", ".polygon", ".geom", ".geometry", "staticgeometry", "static_geometry"),
    "collision": ("collision", "collider", "blocking_volume", "physics"),
    "navigation": ("navmesh", "navigation", "waypoint", "pathfinding", "passability"),
    "material": (".material", "/materials/"),
    "texture": (".tex", ".dds", ".pvr", ".png", ".jpg", ".jpeg", "/textures/"),
}


class InventoryError(RuntimeError):
    """Actionable archive or extraction error."""


def normalize_member(name: str) -> str:
    return name.replace("\\", "/").lstrip("/")


def suffix_key(name: str) -> str:
    suffixes = pathlib.PurePosixPath(name).suffixes
    if not suffixes:
        return "<none>"
    if suffixes[-1].lower() == ".dvpl" and len(suffixes) >= 2:
        return "".join(suffixes[-2:]).lower()
    return suffixes[-1].lower()


def map_id_from_member(name: str) -> str | None:
    parts = pathlib.PurePosixPath(normalize_member(name)).parts
    if not parts:
        return None
    lower = [part.lower() for part in parts]
    if "maps" in lower:
        index = lower.index("maps") + 1
        if index < len(parts) and MAP_ID_RE.fullmatch(parts[index]):
            return parts[index]
        return None
    if MAP_ID_RE.fullmatch(parts[0]):
        return parts[0]
    return None


def candidate_groups(name: str) -> list[str]:
    value = "/" + normalize_member(name).lower()
    groups = []
    for group, tokens in CANDIDATE_TOKENS.items():
        if any(token in value for token in tokens):
            groups.append(group)
    return groups


def add_sample(samples: dict[str, list[str]], key: str, value: str, limit: int) -> None:
    bucket = samples[key]
    if len(bucket) < limit:
        bucket.append(value)


def build_inventory(archive_path: pathlib.Path, sample_limit: int) -> dict[str, Any]:
    extension_counts: Counter[str] = Counter()
    extension_bytes: Counter[str] = Counter()
    extension_samples: dict[str, list[str]] = defaultdict(list)
    category_counts: Counter[str] = Counter()
    category_bytes: Counter[str] = Counter()
    category_samples: dict[str, list[str]] = defaultdict(list)
    map_counts: Counter[str] = Counter()
    map_bytes: Counter[str] = Counter()
    map_category_counts: dict[str, Counter[str]] = defaultdict(Counter)
    top_level_counts: Counter[str] = Counter()

    compressed_total = 0
    uncompressed_total = 0
    file_count = 0

    # Inventory is central-directory-only on purpose: do not call testzip() here,
    # because that would decompress the entire multi-GB archive.
    with zipfile.ZipFile(archive_path) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            file_count += 1
            compressed_total += info.compress_size
            uncompressed_total += info.file_size
            name = normalize_member(info.filename)
            parts = pathlib.PurePosixPath(name).parts
            if parts:
                top_level_counts[parts[0]] += 1

            extension = suffix_key(name)
            extension_counts[extension] += 1
            extension_bytes[extension] += info.file_size
            add_sample(extension_samples, extension, name, sample_limit)

            groups = candidate_groups(name)
            for group in groups:
                category_counts[group] += 1
                category_bytes[group] += info.file_size
                add_sample(category_samples, group, name, sample_limit)

            map_id = map_id_from_member(name)
            if map_id:
                map_counts[map_id] += 1
                map_bytes[map_id] += info.file_size
                for group in groups:
                    map_category_counts[map_id][group] += 1

    extensions = [
        {
            "extension": extension,
            "count": extension_counts[extension],
            "uncompressedBytes": extension_bytes[extension],
            "samplePaths": extension_samples[extension],
        }
        for extension in sorted(extension_counts, key=lambda key: (-extension_counts[key], key))
    ]
    maps = [
        {
            "mapId": map_id,
            "fileCount": map_counts[map_id],
            "uncompressedBytes": map_bytes[map_id],
            "candidateCounts": dict(sorted(map_category_counts[map_id].items())),
        }
        for map_id in sorted(map_counts)
    ]
    candidates = {
        group: {
            "count": category_counts[group],
            "uncompressedBytes": category_bytes[group],
            "samplePaths": category_samples[group],
        }
        for group in CANDIDATE_TOKENS
    }

    return {
        "schemaVersion": 1,
        "source": {
            "archiveName": archive_path.name,
            "archiveBytes": archive_path.stat().st_size,
            "fileCount": file_count,
            "compressedMemberBytes": compressed_total,
            "uncompressedMemberBytes": uncompressed_total,
        },
        "topLevelEntries": dict(sorted(top_level_counts.items())),
        "mapCount": len(maps),
        "maps": maps,
        "extensions": extensions,
        "candidateGroups": candidates,
        "interpretationRule": (
            "candidateGroups are path/name evidence only; presence does not prove a decoded, "
            "renderable, collidable, or navigable resource."
        ),
    }


def safe_relative_member(name: str) -> pathlib.PurePosixPath:
    relative = pathlib.PurePosixPath(normalize_member(name))
    if relative.is_absolute() or ".." in relative.parts:
        raise InventoryError(f"unsafe archive member path: {name}")
    return relative


def extract_map(
    archive_path: pathlib.Path,
    map_id: str,
    output_dir: pathlib.Path,
    max_extract_bytes: int,
) -> tuple[int, int]:
    selected: list[zipfile.ZipInfo] = []
    total = 0
    with zipfile.ZipFile(archive_path) as archive:
        for info in archive.infolist():
            if info.is_dir() or map_id_from_member(info.filename) != map_id:
                continue
            selected.append(info)
            total += info.file_size

        if not selected:
            raise InventoryError(f"map id not found in archive: {map_id}")
        if total > max_extract_bytes:
            raise InventoryError(
                f"{map_id} requires {total} bytes, exceeding --max-extract-bytes={max_extract_bytes}"
            )

        output_dir.mkdir(parents=True, exist_ok=True)
        root = output_dir.resolve()
        for info in selected:
            relative = safe_relative_member(info.filename)
            parts = relative.parts
            lower = [part.lower() for part in parts]
            if "maps" in lower:
                relative = pathlib.PurePosixPath(*parts[lower.index("maps") + 1 :])
            target = (root / pathlib.Path(*relative.parts)).resolve()
            try:
                target.relative_to(root)
            except ValueError as error:
                raise InventoryError(f"archive member escapes output directory: {info.filename}") from error
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(info) as source, target.open("wb") as destination:
                while chunk := source.read(1024 * 1024):
                    destination.write(chunk)

    return len(selected), total


def write_report(report: dict[str, Any], output: pathlib.Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("input", type=pathlib.Path, help="Path to Maps.zip")
    parser.add_argument(
        "--output",
        type=pathlib.Path,
        default=pathlib.Path("tmp/map-research/maps-inventory.json"),
        help="JSON inventory output (default: tmp/map-research/maps-inventory.json)",
    )
    parser.add_argument(
        "--sample-limit",
        type=int,
        default=12,
        help="Maximum sample paths kept per extension/candidate group (default: 12)",
    )
    parser.add_argument("--extract-map", help="Optionally extract exactly one client map id")
    parser.add_argument(
        "--extract-dir",
        type=pathlib.Path,
        default=pathlib.Path("tmp/map-research/extracted"),
        help="Extraction root used with --extract-map",
    )
    parser.add_argument(
        "--max-extract-bytes",
        type=int,
        default=1_073_741_824,
        help="Safety cap for one-map extraction (default: 1 GiB)",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    archive_path = args.input.expanduser().resolve()
    if args.sample_limit < 1:
        print("error: --sample-limit must be >= 1", file=sys.stderr)
        return 2
    if not archive_path.is_file():
        print(f"error: archive not found: {archive_path}", file=sys.stderr)
        return 2

    try:
        report = build_inventory(archive_path, args.sample_limit)
        output = args.output.expanduser().resolve()
        write_report(report, output)
        print(
            f"inventory: {report['source']['fileCount']} files, "
            f"{report['mapCount']} map directories -> {output}"
        )
        if args.extract_map:
            extracted_count, extracted_bytes = extract_map(
                archive_path,
                args.extract_map,
                args.extract_dir.expanduser().resolve(),
                args.max_extract_bytes,
            )
            print(
                f"extracted {args.extract_map}: {extracted_count} files, "
                f"{extracted_bytes} bytes -> {args.extract_dir.expanduser().resolve()}"
            )
    except (OSError, ValueError, zipfile.BadZipFile, InventoryError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
