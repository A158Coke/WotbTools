#!/usr/bin/env python3
"""Inspect one map's main SC2 scene directly from Maps.zip.

This is an evidence tool for 3D Playback research. It reuses the repository's
DVPL + SceneFileV2 parser and reports scene/component/resource-reference facts;
it does not guess that a referenced resource is renderable/collidable until its
inner format is separately decoded.

Usage:
    python common/python/inspect_map_scene.py C:\\path\\to\\Maps.zip 05_amigosville_am
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
import zipfile
from collections import Counter, defaultdict
from typing import Any, Iterator

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from wotb_sc2 import (  # noqa: E402
    Sc2ParseError,
    decode_dvpl,
    entity_components,
    read_sc2,
    scene_entities,
)

ASSET_SUFFIX_RE = re.compile(
    r"\.(?:sc2|scg|dds|pvr|png|jpg|jpeg|heightmap|mkm|lka|anim|yaml|material|tex)$",
    re.IGNORECASE,
)
PATHISH_RE = re.compile(r"[/\\]")


class InspectError(RuntimeError):
    """Actionable scene inspection error."""


def normalize_member(name: str) -> str:
    return name.replace("\\", "/").lstrip("/")


def unwrap_dvpl_suffix(value: str) -> str:
    return value[:-5] if value.lower().endswith(".dvpl") else value


def suffix_key(value: str) -> str:
    normalized = unwrap_dvpl_suffix(value).lower()
    suffix = pathlib.PurePosixPath(normalized.replace("\\", "/")).suffix
    return suffix or "<none>"


def select_scene_member(
    archive: zipfile.ZipFile,
    map_id: str,
    explicit_scene: str | None,
) -> zipfile.ZipInfo:
    files = [info for info in archive.infolist() if not info.is_dir()]
    if explicit_scene:
        wanted = normalize_member(explicit_scene).lower()
        matches = [info for info in files if normalize_member(info.filename).lower() == wanted]
        if len(matches) != 1:
            raise InspectError(
                f"--scene must match exactly one archive member; matched {len(matches)}: {explicit_scene}"
            )
        return matches[0]

    preferred = {
        f"maps/{map_id}/{map_id}.sc2.dvpl".lower(),
        f"{map_id}/{map_id}.sc2.dvpl".lower(),
    }
    exact = [info for info in files if normalize_member(info.filename).lower() in preferred]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        raise InspectError(f"multiple exact main scenes found for {map_id}")

    prefix = f"maps/{map_id}/".lower()
    candidates = [
        info
        for info in files
        if normalize_member(info.filename).lower().startswith(prefix)
        and normalize_member(info.filename).lower().endswith(".sc2.dvpl")
    ]
    if not candidates:
        raise InspectError(f"no SC2 scene found for map: {map_id}")
    rendered = ", ".join(normalize_member(info.filename) for info in candidates[:12])
    raise InspectError(
        f"main SC2 is ambiguous for {map_id}; use --scene with one of: {rendered}"
    )


def walk(value: Any, path: str = "$" ) -> Iterator[tuple[str, Any]]:
    yield path, value
    if isinstance(value, dict):
        for key, child in value.items():
            yield from walk(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from walk(child, f"{path}[{index}]")


def is_resource_reference(value: str) -> bool:
    candidate = unwrap_dvpl_suffix(value.strip())
    return bool(ASSET_SUFFIX_RE.search(candidate) or (PATHISH_RE.search(candidate) and "." in candidate))


def add_sample(bucket: list[Any], value: Any, limit: int) -> None:
    if len(bucket) < limit:
        bucket.append(value)


def inspect_scene(scene: dict[str, Any], scene_member: zipfile.ZipInfo, sample_limit: int) -> dict[str, Any]:
    entities = scene_entities(scene)
    component_counts: Counter[str] = Counter()
    entity_name_samples: list[str] = []
    render_component_keys: Counter[str] = Counter()
    render_object_keys: Counter[str] = Counter()
    render_object_value_types: Counter[str] = Counter()

    for entity in entities:
        name = entity.get("name")
        if isinstance(name, str):
            add_sample(entity_name_samples, name, sample_limit)
        for component in entity_components(entity):
            type_name = str(component.get("comp.typename", "<unknown>"))
            component_counts[type_name] += 1
            if type_name != "RenderComponent":
                continue
            for key in component:
                render_component_keys[str(key)] += 1
            render_object = component.get("rc.renderObj")
            if isinstance(render_object, dict):
                for key, value in render_object.items():
                    render_object_keys[str(key)] += 1
                    render_object_value_types[f"{key}:{type(value).__name__}"] += 1

    reference_counts: Counter[str] = Counter()
    references_by_extension: dict[str, list[str]] = defaultdict(list)
    reference_paths: dict[str, list[str]] = defaultdict(list)
    binary_field_count = 0
    binary_total_bytes = 0
    binary_samples: list[dict[str, Any]] = []
    string_samples: list[dict[str, str]] = []

    for path, value in walk(scene):
        if isinstance(value, str):
            if is_resource_reference(value):
                normalized = value.replace("\\", "/")
                extension = suffix_key(normalized)
                reference_counts[extension] += 1
                if normalized not in references_by_extension[extension]:
                    add_sample(references_by_extension[extension], normalized, sample_limit)
                add_sample(reference_paths[normalized], path, 3)
            elif ("render" in path.lower() or "polygon" in path.lower()) and value:
                add_sample(string_samples, {"path": path, "value": value}, sample_limit)
        elif isinstance(value, dict) and isinstance(value.get("$bytes"), str):
            try:
                size = len(bytes.fromhex(value["$bytes"]))
            except ValueError:
                continue
            binary_field_count += 1
            binary_total_bytes += size
            add_sample(binary_samples, {"path": path, "bytes": size}, sample_limit)

    unique_references = [
        {
            "value": value,
            "extension": suffix_key(value),
            "paths": paths,
        }
        for value, paths in sorted(reference_paths.items())
    ]

    return {
        "schemaVersion": 1,
        "sceneMember": normalize_member(scene_member.filename),
        "sceneCompressedBytes": scene_member.compress_size,
        "sceneStoredBytes": scene_member.file_size,
        "sceneMetadata": scene.get("$metadata", {}),
        "entityCount": len(entities),
        "entityNameSamples": entity_name_samples,
        "componentTypeCounts": dict(component_counts.most_common()),
        "renderComponentKeyCounts": dict(render_component_keys.most_common()),
        "renderObjectKeyCounts": dict(render_object_keys.most_common()),
        "renderObjectValueTypeCounts": dict(render_object_value_types.most_common()),
        "resourceReferences": {
            "countByExtension": dict(reference_counts.most_common()),
            "samplesByExtension": dict(sorted(references_by_extension.items())),
            "unique": unique_references,
        },
        "binaryFields": {
            "count": binary_field_count,
            "totalDecodedBytes": binary_total_bytes,
            "samples": binary_samples,
        },
        "renderRelatedStringSamples": string_samples,
        "interpretationRule": (
            "String paths and render-object fields are exact decoded SC2 evidence. "
            "A path/field alone does not prove the referenced payload's semantic role; "
            "decode the referenced resource before calling it geometry/collision/navigation."
        ),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("input", type=pathlib.Path, help="Path to Maps.zip")
    parser.add_argument("map_id", help="Client map id, e.g. 05_amigosville_am")
    parser.add_argument(
        "--scene",
        help="Exact archive member for maps with multiple SC2 files",
    )
    parser.add_argument(
        "--output",
        type=pathlib.Path,
        help="JSON output; default tmp/map-research/<map-id>-scene-inspection.json",
    )
    parser.add_argument("--sample-limit", type=int, default=30)
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
        f"tmp/map-research/{args.map_id}-scene-inspection.json"
    )
    try:
        with zipfile.ZipFile(archive_path) as archive:
            member = select_scene_member(archive, args.map_id, args.scene)
            raw = archive.read(member)
        scene = read_sc2(decode_dvpl(raw))
        report = inspect_scene(scene, member, args.sample_limit)
        output = output.expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except (OSError, ValueError, zipfile.BadZipFile, Sc2ParseError, InspectError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    print(
        f"scene inspection: {report['entityCount']} entities, "
        f"{len(report['resourceReferences']['unique'])} unique resource references -> {output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
