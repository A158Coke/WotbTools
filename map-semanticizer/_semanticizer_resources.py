"""Map resource discovery and stable source identity."""
from __future__ import annotations
import pathlib
from _semanticizer_binary import SemanticizerError


def normalized_resource_suffix(path: pathlib.Path) -> str:
    name = path.name.lower()
    return name[:-5] if name.endswith(".dvpl") else name


def discover_map_resources(root: pathlib.Path) -> tuple[pathlib.Path, pathlib.Path]:
    files = [path for path in root.rglob("*") if path.is_file()]
    scenes = [path for path in files if normalized_resource_suffix(path).endswith(".sc2")]
    heightmaps = [
        path for path in files if normalized_resource_suffix(path).endswith(".heightmap")
    ]
    if not scenes:
        raise SemanticizerError(f"No .sc2 or .sc2.dvpl found under {root}")
    if not heightmaps:
        raise SemanticizerError(f"No .heightmap or .heightmap.dvpl found under {root}")
    def resource_rank(path: pathlib.Path, expected_stem: str | None = None) -> tuple[int, int, int]:
        normalized_name = normalized_resource_suffix(path)
        stem = normalized_name[:-4] if normalized_name.endswith(".sc2") else pathlib.Path(normalized_name).stem
        relative_depth = len(path.relative_to(root).parts)
        return (
            int(expected_stem is not None and stem.lower() == expected_stem.lower()),
            -relative_depth,
            path.stat().st_size,
        )

    scene = max(scenes, key=lambda path: resource_rank(path, root.name))
    heightmap = max(heightmaps, key=lambda path: resource_rank(path))
    return scene, heightmap


def infer_map_id(scene_path: pathlib.Path) -> str:
    name = scene_path.name
    if name.lower().endswith(".dvpl"):
        name = name[:-5]
    if name.lower().endswith(".sc2"):
        name = name[:-4]
    return name
