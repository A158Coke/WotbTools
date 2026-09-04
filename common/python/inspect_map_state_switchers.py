#!/usr/bin/env python3
"""Inspect scene-level switch/state visibility semantics for one battle map.

This tool exists because RenderBatch LOD/switch selection alone is insufficient
for proving the initially visible static scene. WoT Blitz map scenes can contain
state variants under scene entities (for example destructible-object states).
The report keeps raw component fields and hierarchy evidence so production code
does not need to infer behavior from entity filenames.

Usage:
    python common/python/inspect_map_state_switchers.py C:\\path\\to\\Maps.zip 18_canal_cn

Default output:
    tmp/map-research/<map-id>-state-switcher-inspection.json
"""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
import zipfile
from collections import Counter
from typing import Any, Iterator

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))

from wotb_sc2 import (  # noqa: E402
    Sc2ParseError,
    decode_dvpl,
    entity_components,
    read_sc2,
)

VISIBLE_FLAG = 1 << 0
STATE_NAME_RE = re.compile(r"\bState\s+([01])\b", re.IGNORECASE)
TARGET_COMPONENT_TYPES = {"StateSwitcherComponent", "SwitchComponent"}


class InspectStateSwitcherError(RuntimeError):
    """Actionable state-switcher inspection error."""


def normalize_member(name: str) -> str:
    return name.replace("\\", "/").lstrip("/")


def select_scene_member(
    archive: zipfile.ZipFile,
    map_id: str,
    explicit_scene: str | None = None,
) -> zipfile.ZipInfo:
    files = [info for info in archive.infolist() if not info.is_dir()]
    if explicit_scene:
        wanted = normalize_member(explicit_scene).lower()
        matches = [info for info in files if normalize_member(info.filename).lower() == wanted]
        if len(matches) != 1:
            raise InspectStateSwitcherError(
                f"--scene must match exactly one archive member; matched {len(matches)}: {explicit_scene}"
            )
        return matches[0]

    by_name = {normalize_member(info.filename).lower(): info for info in files}
    for candidate in (
        f"Maps/{map_id}/{map_id}.sc2.dvpl",
        f"Maps/{map_id}/{map_id}.sc2",
        f"{map_id}/{map_id}.sc2.dvpl",
        f"{map_id}/{map_id}.sc2",
    ):
        match = by_name.get(candidate.lower())
        if match is not None:
            return match

    prefixes = (f"maps/{map_id}/".lower(), f"{map_id}/".lower())
    candidates = [
        info
        for info in files
        if any(normalize_member(info.filename).lower().startswith(prefix) for prefix in prefixes)
        and normalize_member(info.filename).lower().endswith((".sc2.dvpl", ".sc2"))
    ]
    if len(candidates) == 1:
        return candidates[0]
    if not candidates:
        raise InspectStateSwitcherError(f"main SC2 not found for map: {map_id}")
    rendered = ", ".join(normalize_member(info.filename) for info in candidates[:12])
    raise InspectStateSwitcherError(
        f"main SC2 is ambiguous for {map_id}; use --scene with one of: {rendered}"
    )


def iter_entities_recursive(
    container: dict[str, Any], path: str = "$"
) -> Iterator[tuple[str, dict[str, Any], str | None, dict[str, Any] | None]]:
    hierarchy = container.get("#hierarchy")
    if not isinstance(hierarchy, list):
        return
    for index, entity in enumerate(hierarchy):
        if not isinstance(entity, dict):
            continue
        entity_path = f"{path}.#hierarchy[{index}]"
        parent = container if path != "$" else None
        parent_path = path if path != "$" else None
        yield entity_path, entity, parent_path, parent
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


def component_types(entity: dict[str, Any]) -> list[str]:
    return [
        str(component.get("comp.typename", "<unknown>"))
        for component in entity_components(entity)
    ]


def summarize_value(value: Any, depth: int = 0) -> Any:
    if isinstance(value, dict) and isinstance(value.get("$bytes"), str):
        payload = value["$bytes"]
        return {
            "$bytesHexChars": len(payload),
            "$bytes": len(payload) // 2,
            "prefixHex": payload[:32],
        }
    if depth >= 4:
        if isinstance(value, dict):
            return {"$dictKeys": list(value)[:20], "$dictSize": len(value)}
        if isinstance(value, list):
            return {"$listSize": len(value)}
        return value
    if isinstance(value, dict):
        return {
            str(key): summarize_value(child, depth + 1)
            for key, child in value.items()
        }
    if isinstance(value, list):
        return [summarize_value(child, depth + 1) for child in value]
    return value


def indexed_render_batches(
    render_object: dict[str, Any],
) -> Iterator[tuple[int, dict[str, Any]]]:
    batches = render_object.get("ro.batches")
    if isinstance(batches, list):
        for index, batch in enumerate(batches):
            if isinstance(batch, dict):
                yield index, batch
        return
    if not isinstance(batches, dict):
        return
    for raw_index, batch in batches.items():
        if not isinstance(batch, dict):
            continue
        text = str(raw_index)
        if not text.isdigit():
            raise InspectStateSwitcherError(
                f"RenderObject has non-numeric ro.batches key {raw_index!r}"
            )
        yield int(text), batch


def render_summary(entity: dict[str, Any]) -> dict[str, Any] | None:
    render = component_by_type(entity, "RenderComponent")
    if render is None:
        return None
    render_object = render.get("rc.renderObj")
    if not isinstance(render_object, dict):
        return {"renderObject": None}

    raw_flags = render_object.get("ro.flags")
    flags = raw_flags if isinstance(raw_flags, int) else None
    batches: list[dict[str, Any]] = []
    for batch_index, batch in indexed_render_batches(render_object):
        batches.append(
            {
                "batchIndex": batch_index,
                "datasourceId": batch.get("rb.datasource")
                if isinstance(batch.get("rb.datasource"), int)
                else None,
                "lodIndex": render_object.get(f"rb{batch_index}.lodIndex", -1),
                "switchIndex": render_object.get(f"rb{batch_index}.switchIndex", -1),
            }
        )

    return {
        "class": render_object.get("##name"),
        "flags": flags,
        "visibleBitSet": bool(flags & VISIBLE_FLAG) if flags is not None else None,
        "notShadowOnly": render_object.get("ro.notShadowOnly"),
        "batchCountDeclared": render_object.get("ro.batchCount"),
        "batches": batches,
    }


def entity_summary(path: str, entity: dict[str, Any]) -> dict[str, Any]:
    return {
        "path": path,
        "name": entity.get("name") if isinstance(entity.get("name"), str) else None,
        "componentTypes": component_types(entity),
        "render": render_summary(entity),
    }


def immediate_children(path: str, entity: dict[str, Any]) -> list[dict[str, Any]]:
    hierarchy = entity.get("#hierarchy")
    if not isinstance(hierarchy, list):
        return []
    children: list[dict[str, Any]] = []
    for index, child in enumerate(hierarchy):
        if isinstance(child, dict):
            children.append(entity_summary(f"{path}.#hierarchy[{index}]", child))
    return children


def state_name_index(entity: dict[str, Any]) -> int | None:
    name = entity.get("name")
    if not isinstance(name, str):
        return None
    match = STATE_NAME_RE.search(name)
    return int(match.group(1)) if match is not None else None


def build_report(
    scene: dict[str, Any],
    map_id: str,
    scene_member: zipfile.ZipInfo,
    sample_limit: int,
) -> dict[str, Any]:
    all_entities = list(iter_entities_recursive(scene))
    component_counts: Counter[str] = Counter()
    mesh_visibility: Counter[str] = Counter()
    target_records: list[dict[str, Any]] = []
    state_like_groups: list[dict[str, Any]] = []
    state_like_visibility: Counter[str] = Counter()
    state_like_batch_switches: Counter[str] = Counter()

    for path, entity, _, _ in all_entities:
        types = component_types(entity)
        component_counts.update(types)
        render = render_summary(entity)
        if render is not None and render.get("class") == "Mesh":
            visible = render.get("visibleBitSet")
            mesh_visibility[str(visible)] += 1

        target_components = [
            component
            for component in entity_components(entity)
            if component.get("comp.typename") in TARGET_COMPONENT_TYPES
        ]
        if target_components:
            target_records.append(
                {
                    "entity": entity_summary(path, entity),
                    "components": [summarize_value(component) for component in target_components],
                    "children": immediate_children(path, entity),
                }
            )

        hierarchy = entity.get("#hierarchy")
        if not isinstance(hierarchy, list):
            continue
        by_state: dict[int, list[tuple[int, dict[str, Any]]]] = {0: [], 1: []}
        for child_index, child in enumerate(hierarchy):
            if not isinstance(child, dict):
                continue
            state_index = state_name_index(child)
            if state_index in by_state:
                by_state[state_index].append((child_index, child))
        if not by_state[0] or not by_state[1]:
            continue

        children: list[dict[str, Any]] = []
        for state_index in (0, 1):
            for child_index, child in by_state[state_index]:
                child_path = f"{path}.#hierarchy[{child_index}]"
                summary = entity_summary(child_path, child)
                summary["diagnosticStateNameIndex"] = state_index
                children.append(summary)
                render = summary.get("render")
                if isinstance(render, dict):
                    state_like_visibility[
                        f"state{state_index}:visible={render.get('visibleBitSet')}"
                    ] += 1
                    for batch in render.get("batches", []):
                        state_like_batch_switches[
                            f"state{state_index}:switch={batch.get('switchIndex')}"
                        ] += 1
        state_like_groups.append(
            {
                "parent": entity_summary(path, entity),
                "targetComponents": [
                    summarize_value(component)
                    for component in entity_components(entity)
                    if component.get("comp.typename") in TARGET_COMPONENT_TYPES
                ],
                "children": children,
            }
        )

    return {
        "schemaVersion": 1,
        "mapId": map_id,
        "sceneMember": normalize_member(scene_member.filename),
        "sceneMetadata": scene.get("$metadata", {}),
        "entityCountRecursive": len(all_entities),
        "componentTypeCounts": dict(component_counts.most_common()),
        "meshRenderObjectVisibilityBitCounts": dict(mesh_visibility.most_common()),
        "switchStateComponents": {
            "count": len(target_records),
            "records": target_records[:sample_limit],
            "truncated": max(0, len(target_records) - sample_limit),
        },
        "diagnosticStateNameSiblingGroups": {
            "warning": (
                "State 0/State 1 entity names are used only to locate suspicious sibling groups "
                "for research. Production selection must be based on proven component/visibility "
                "semantics, never on this filename heuristic."
            ),
            "count": len(state_like_groups),
            "visibilityCounts": dict(state_like_visibility.most_common()),
            "batchSwitchCounts": dict(state_like_batch_switches.most_common()),
            "records": state_like_groups[:sample_limit],
            "truncated": max(0, len(state_like_groups) - sample_limit),
        },
        "evidenceRule": (
            "Component archives, hierarchy, RenderObject ro.flags visible bit, and batch options "
            "are decoded scene facts. State-like entity-name matching is diagnostic only and is "
            "not a production semantic contract."
        ),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("input", type=pathlib.Path, help="Path to Maps.zip")
    parser.add_argument("map_id", help="Client map id, e.g. 18_canal_cn")
    parser.add_argument(
        "--scene",
        help="Exact archive member for maps with multiple SC2 files",
    )
    parser.add_argument(
        "--output",
        type=pathlib.Path,
        help=(
            "JSON output; default "
            "tmp/map-research/<map-id>-state-switcher-inspection.json"
        ),
    )
    parser.add_argument(
        "--sample-limit",
        type=int,
        default=80,
        help="Maximum detailed component/state groups to retain; default 80",
    )
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.sample_limit < 1:
        print("error: --sample-limit must be >= 1", file=sys.stderr)
        return 2

    archive_path = args.input.expanduser().resolve()
    if not archive_path.is_file():
        print(f"error: archive not found: {archive_path}", file=sys.stderr)
        return 2

    output = args.output or pathlib.Path(
        f"tmp/map-research/{args.map_id}-state-switcher-inspection.json"
    )

    try:
        with zipfile.ZipFile(archive_path) as archive:
            scene_member = select_scene_member(archive, args.map_id, args.scene)
            raw = archive.read(scene_member)
        payload = (
            decode_dvpl(raw)
            if normalize_member(scene_member.filename).lower().endswith(".dvpl")
            else raw
        )
        scene = read_sc2(payload)
        report = build_report(scene, args.map_id, scene_member, args.sample_limit)

        output = output.expanduser().resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
    except (
        OSError,
        ValueError,
        zipfile.BadZipFile,
        Sc2ParseError,
        InspectStateSwitcherError,
    ) as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    switchers = report["switchStateComponents"]
    state_groups = report["diagnosticStateNameSiblingGroups"]
    print(
        f"state-switcher inspection: {report['entityCountRecursive']} entities, "
        f"{switchers['count']} switch/state components, "
        f"{state_groups['count']} diagnostic state sibling groups -> {output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
