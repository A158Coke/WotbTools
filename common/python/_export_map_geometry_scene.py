"""SC2 entity traversal, transform and active batch selection."""
from __future__ import annotations
import zipfile
from collections import Counter
from typing import Any, Iterator
from wotb_sc2 import entity_components

SHARED_BATCH_INDEX = -1


RENDER_OBJECT_VISIBLE_FLAG = 1 << 0


class ExportMapGeometryError(RuntimeError):
    """Actionable map-geometry export error."""


def normalize_member(name: str) -> str:
    return name.replace("\\", "/").lstrip("/")


def archive_files(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    return [info for info in archive.infolist() if not info.is_dir()]


def select_scene_member(archive: zipfile.ZipFile, map_id: str) -> zipfile.ZipInfo:
    by_name = {
        normalize_member(info.filename).lower(): info
        for info in archive_files(archive)
    }
    for candidate in (
        f"Maps/{map_id}/{map_id}.sc2.dvpl",
        f"{map_id}/{map_id}.sc2.dvpl",
        f"Maps/{map_id}/{map_id}.sc2",
        f"{map_id}/{map_id}.sc2",
    ):
        match = by_name.get(candidate.lower())
        if match is not None:
            return match
    raise ExportMapGeometryError(f"main SC2 not found for map: {map_id}")


def select_companion_scg(
    archive: zipfile.ZipFile,
    scene_member: zipfile.ZipInfo,
) -> zipfile.ZipInfo:
    scene_name = normalize_member(scene_member.filename)
    lower = scene_name.lower()
    if lower.endswith(".sc2.dvpl"):
        candidates = (scene_name[:-9] + ".scg.dvpl", scene_name[:-9] + ".scg")
    elif lower.endswith(".sc2"):
        candidates = (scene_name[:-4] + ".scg", scene_name[:-4] + ".scg.dvpl")
    else:
        candidates = ()

    by_name = {
        normalize_member(info.filename).lower(): info
        for info in archive_files(archive)
    }
    for candidate in candidates:
        match = by_name.get(candidate.lower())
        if match is not None:
            return match
    raise ExportMapGeometryError(
        f"companion SCG not found for main scene: {scene_name}"
    )


def iter_entities_recursive(
    container: dict[str, Any], path: str = "$"
) -> Iterator[tuple[str, dict[str, Any]]]:
    """Yield all SC2 entities, including nested ``#hierarchy`` children."""

    hierarchy = container.get("#hierarchy")
    if not isinstance(hierarchy, list):
        return
    for index, entity in enumerate(hierarchy):
        if not isinstance(entity, dict):
            continue
        entity_path = f"{path}.#hierarchy[{index}]"
        yield entity_path, entity
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


def vector(
    component: dict[str, Any] | None,
    key: str,
    size: int,
    default: tuple[float, ...],
) -> list[float]:
    if component is None:
        return list(default)
    value = component.get(key)
    if not isinstance(value, list) or len(value) != size:
        return list(default)
    return [float(item) for item in value]


def world_transform(entity: dict[str, Any]) -> dict[str, list[float]]:
    transform = component_by_type(entity, "TransformComponent")
    return {
        "translation": vector(
            transform, "tc.worldTranslation", 3, (0.0, 0.0, 0.0)
        ),
        "scale": vector(transform, "tc.worldScale", 3, (1.0, 1.0, 1.0)),
        "rotationQuaternionXYZW": vector(
            transform, "tc.worldRotation", 4, (0.0, 0.0, 0.0, 1.0)
        ),
    }


def iter_render_batches(
    render_object: dict[str, Any],
) -> Iterator[tuple[int, dict[str, Any]]]:
    """Yield batch index + archive while preserving DAVA GenKeyFromIndex ids."""

    batches = render_object.get("ro.batches")
    if isinstance(batches, dict):
        for raw_index, batch in batches.items():
            if not isinstance(batch, dict):
                continue
            text = str(raw_index)
            if not text.isdigit():
                raise ExportMapGeometryError(
                    f"RenderObject has non-numeric ro.batches key {raw_index!r}"
                )
            yield int(text), batch
    elif isinstance(batches, list):
        for index, batch in enumerate(batches):
            if isinstance(batch, dict):
                yield index, batch


def batch_option(render_object: dict[str, Any], batch_index: int, name: str) -> int:
    """Read DAVA batch option; SceneFileV2 load defaults missing values to -1."""

    value = render_object.get(f"rb{batch_index}.{name}", SHARED_BATCH_INDEX)
    if not isinstance(value, int):
        raise ExportMapGeometryError(
            f"RenderObject rb{batch_index}.{name} must be int, got {type(value).__name__}"
        )
    return value


def batch_is_active(batch_index: int, requested_index: int) -> bool:
    """Mirror RenderObject::UpdateActiveRenderBatchesFromCollection."""

    return batch_index == requested_index or batch_index == SHARED_BATCH_INDEX


def render_object_is_visible(render_object: dict[str, Any]) -> bool:
    """Mirror the serialized DAVA RenderObject VISIBLE flag for initial state.

    RenderObject::Load defaults a missing ``ro.flags`` field to its serialization
    criteria, which includes VISIBLE. Therefore absence means visible; an
    explicit flags value must be an integer and bit 0 controls visibility.
    """

    flags = render_object.get("ro.flags")
    if flags is None:
        return True
    if not isinstance(flags, int):
        raise ExportMapGeometryError(
            f"RenderObject ro.flags must be int, got {type(flags).__name__}"
        )
    return (flags & RENDER_OBJECT_VISIBLE_FLAG) == RENDER_OBJECT_VISIBLE_FLAG


def collect_instances(
    scene: dict[str, Any],
    target_lod: int,
    target_switch: int,
) -> tuple[list[dict[str, Any]], Counter[str]]:
    """Collect initially visible active Mesh batches without baking transforms."""

    instances: list[dict[str, Any]] = []
    skipped: Counter[str] = Counter()
    seen: set[tuple[str, int, int]] = set()

    for entity_path, entity in iter_entities_recursive(scene):
        render = component_by_type(entity, "RenderComponent")
        if render is None:
            continue
        render_object = render.get("rc.renderObj")
        if not isinstance(render_object, dict):
            skipped["render_object_missing"] += 1
            continue
        render_class = str(render_object.get("##name", "<unknown>"))
        if render_class != "Mesh":
            skipped[f"render_class:{render_class}"] += 1
            continue
        if not render_object_is_visible(render_object):
            skipped["invisible_render_object"] += 1
            continue
        if render_object.get("ro.notShadowOnly") is False:
            skipped["shadow_only"] += 1
            continue

        entity_name = entity.get("name")
        transform = world_transform(entity)
        for batch_index, batch in iter_render_batches(render_object):
            datasource = batch.get("rb.datasource")
            if not isinstance(datasource, int):
                skipped["batch_without_datasource"] += 1
                continue

            lod_index = batch_option(render_object, batch_index, "lodIndex")
            switch_index = batch_option(render_object, batch_index, "switchIndex")
            if not batch_is_active(lod_index, target_lod):
                skipped["inactive_lod"] += 1
                continue
            if not batch_is_active(switch_index, target_switch):
                skipped["inactive_switch"] += 1
                continue

            signature = (entity_path, datasource, batch_index)
            if signature in seen:
                skipped["duplicate_signature"] += 1
                continue
            seen.add(signature)
            instances.append(
                {
                    "entityPath": entity_path,
                    "entityName": entity_name if isinstance(entity_name, str) else None,
                    "datasourceId": datasource,
                    "datasourceIdHex": f"0x{datasource:016x}",
                    "batchIndex": batch_index,
                    "lodIndex": lod_index,
                    "switchIndex": switch_index,
                    "worldTransform": transform,
                }
            )

    return instances, skipped
