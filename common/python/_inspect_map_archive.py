"""Map archive member selection and hierarchy traversal."""
from __future__ import annotations
import pathlib
import re
import zipfile
from typing import Any, Iterator


ASSET_SUFFIX_RE = re.compile(
    r"\.(?:sc2|scg|dds|pvr|png|jpg|jpeg|heightmap|mkm|lka|anim|yaml|material|tex)$",
    re.IGNORECASE,
)


PATHISH_RE = re.compile(r"[/\\]")


class InspectError(RuntimeError):
    """Actionable scene inspection error."""


def normalize_member(name: str) -> str:
    return name.replace("\\", "/").lstrip("/")


def iter_entities_recursive(
    container: dict[str, Any], path: str = "$"
) -> Iterator[tuple[str, dict[str, Any]]]:
    """Yield every entity in nested DAVA ``#hierarchy`` order."""

    hierarchy = container.get("#hierarchy")
    if not isinstance(hierarchy, list):
        return
    for index, entity in enumerate(hierarchy):
        if not isinstance(entity, dict):
            continue
        entity_path = f"{path}.#hierarchy[{index}]"
        yield entity_path, entity
        yield from iter_entities_recursive(entity, entity_path)


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
        raise InspectError(f"no SC2 scene found for map: {map_id}")
    rendered = ", ".join(normalize_member(info.filename) for info in candidates[:12])
    raise InspectError(
        f"main SC2 is ambiguous for {map_id}; use --scene with one of: {rendered}"
    )


def resolve_auxiliary_member(
    archive: zipfile.ZipFile,
    scene_member: zipfile.ZipInfo,
    reference: str,
) -> zipfile.ZipInfo | None:
    base = pathlib.PurePosixPath(normalize_member(scene_member.filename)).parent
    ref = pathlib.PurePosixPath(reference.replace("\\", "/"))
    candidates = [
        normalize_member(str(base / ref)),
        normalize_member(str(base / ref) + ".dvpl"),
    ]
    by_name = {
        normalize_member(info.filename).lower(): info
        for info in archive.infolist()
        if not info.is_dir()
    }
    for candidate in candidates:
        match = by_name.get(candidate.lower())
        if match is not None:
            return match
    return None
