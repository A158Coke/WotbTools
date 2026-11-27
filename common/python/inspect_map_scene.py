"""Inspect one map's main SC2 scene directly from Maps.zip.

This is an evidence tool for 3D Playback research. It reuses the repository's
DVPL + SceneFileV2 parser and reports scene/component/resource-reference facts.
It also inspects SC2 PolygonGroup data nodes and small terrain auxiliary files
referenced by TerrainDataComponent. It does not assign semantic roles to opaque
binary payloads until their formats are decoded.

Usage:
    python common/python/inspect_map_scene.py C:\\path\\to\\Maps.zip 05_amigosville_am
"""
from __future__ import annotations
import argparse
import json
import pathlib
import sys
import zipfile
from typing import Any
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from wotb_sc2 import Sc2ParseError, decode_dvpl, entity_components, read_sc2  # noqa: E402
from _inspect_map_archive import (  # noqa: E402
    ASSET_SUFFIX_RE, PATHISH_RE, InspectError, iter_entities_recursive,
    normalize_member, resolve_auxiliary_member, select_scene_member, suffix_key,
    unwrap_dvpl_suffix,
)
from _inspect_map_data import (  # noqa: E402
    TARGET_COMPONENT_TYPES, add_sample, byte_payload, inspect_data_nodes,
    is_resource_reference, iter_render_batches, summarize_value,
    walk,
)
from _inspect_map_scene_report import inspect_scene  # noqa: E402
from _inspect_map_auxiliary import (  # noqa: E402
    ASCII_RUN_RE, AUXILIARY_EXTENSIONS,
    inspect_auxiliary_resources as _inspect_auxiliary_resources,
)

def decode_scene_payload(raw: bytes, member_name: str) -> bytes:
    """Decode DVPL-wrapped scenes while accepting raw ``.sc2`` members."""
    return decode_dvpl(raw) if normalize_member(member_name).lower().endswith(".dvpl") else raw


def inspect_auxiliary_resources(
    archive: zipfile.ZipFile,
    scene_member: zipfile.ZipInfo,
    report: dict[str, Any],
    sample_limit: int,
) -> list[dict[str, Any]]:
    """Keep the legacy decoder patch point while delegating report assembly."""
    return _inspect_auxiliary_resources(
        archive, scene_member, report, sample_limit, decode_dvpl_fn=decode_dvpl
    )

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
            scene = read_sc2(decode_scene_payload(raw, member.filename))
            report = inspect_scene(scene, member, args.sample_limit)
            report["auxiliaryResources"] = inspect_auxiliary_resources(
                archive, member, report, args.sample_limit
            )
        output = output.expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except (OSError, ValueError, zipfile.BadZipFile, Sc2ParseError, InspectError) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    polygon_groups = report["dataNodes"]["polygonGroups"]
    print(
        f"scene inspection: {report['entityCount']} entities, "
        f"{polygon_groups['count']} polygon groups, "
        f"{len(report['resourceReferences']['unique'])} unique resource references -> {output}"
    )
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
