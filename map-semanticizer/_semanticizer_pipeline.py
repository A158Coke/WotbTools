"""End-to-end semantic document construction and output writes."""
from __future__ import annotations
import json
import pathlib
import statistics
from collections import Counter
from typing import Any, Sequence
from _semanticizer_binary import read_resource
from _semanticizer_keyed_archive import read_sc2
from _semanticizer_scene import battle_points, derive_map_codes, detect_variant, map_border, resolve_display_name, scene_entities, scene_features, world_bounds
from _semanticizer_terrain import build_cells, load_heightmap, percentile, raster_window, sample_height, window_values
from _semanticizer_areas import build_areas
from _semanticizer_relationships import build_relationships, build_spawn_semantics, preserve_reviewed_spawn_sides
from _semanticizer_resources import discover_map_resources, infer_map_id
from _semanticizer_output import render_llm_text, round_cell_for_json


SCHEMA_VERSION = 1


def semanticize(
    input_root: pathlib.Path,
    output_dir: pathlib.Path,
    variant: str | None,
    grid_size: int,
    explicit_map_id: str | None,
    display_name: str | None,
    map_codes: Sequence[str] | None = None,
    known_map_codes: Sequence[str] | None = None,
    known_map_names: dict[str, dict[str, str]] | None = None,
    reviewed_semantics: dict[str, Any] | None = None,
) -> tuple[pathlib.Path, pathlib.Path]:
    scene_path, heightmap_path = discover_map_resources(input_root)
    scene = read_sc2(read_resource(scene_path))
    entities = scene_entities(scene)
    if variant == "auto":
        variant = detect_variant(entities)
    bounds = world_bounds(entities)
    playable = map_border(entities, variant)
    warnings = []
    if playable is None:
        playable = (bounds[0], bounds[1], bounds[3], bounds[4])
        warnings.append(
            f"未找到 {variant} MapBorderComponent；已使用完整 Landscape XY 边界。"
        )
    terrain = load_heightmap(read_resource(heightmap_path), bounds)
    points = battle_points(entities, variant)
    features = scene_features(entities, bounds)
    cells = build_cells(terrain, bounds, playable, features, grid_size)
    areas, cell_to_area = build_areas(cells, playable, grid_size)
    relationships = build_relationships(
        cells, areas, cell_to_area, points, playable, grid_size
    )
    spawns = build_spawn_semantics(points, playable, grid_size, cell_to_area)

    validation_deltas = []
    for point in points:
        if point["type"] not in ("spawnpoint", "controlpoint", "strategicpoint"):
            continue
        x, y, z = point["position"]
        validation_deltas.append(abs(z - sample_height(terrain, bounds, x, y)))
    if not validation_deltas:
        warnings.append("没有可用于 Z 轴交叉校验的出生点/占领点。")

    playable_window = raster_window(playable, bounds, terrain.size)
    playable_heights = window_values(terrain.heights, terrain.size, playable_window)
    playable_slopes = window_values(terrain.slopes, terrain.size, playable_window)
    map_id = explicit_map_id or infer_map_id(scene_path)
    if not map_codes and known_map_codes:
        map_codes = derive_map_codes(map_id, known_map_codes)
    if not display_name and known_map_names:
        display_name = resolve_display_name(map_id, known_map_names)
    document = {
        "schemaVersion": SCHEMA_VERSION,
        "mapId": map_id,
        "mapCodes": sorted(
            {code.strip() for code in (map_codes or []) if code and code.strip()}
        ),
        "displayName": display_name or map_id,
        "verified": False,
        "source": "CLIENT_RESOURCE_DERIVED",
        "battleVariant": variant or "UNKNOWN",
        "warnings": warnings,
        "sourceFiles": {
            "scene": str(scene_path.relative_to(input_root)),
            "heightmap": str(heightmap_path.relative_to(input_root)),
        },
        "coordinateSystem": {
            "units": "meters",
            "axes": {"x": "map horizontal", "y": "map vertical", "z": "elevation"},
            "worldBounds": {
                "xMin": round(bounds[0], 3),
                "yMin": round(bounds[1], 3),
                "zMin": round(bounds[2], 3),
                "xMax": round(bounds[3], 3),
                "yMax": round(bounds[4], 3),
                "zMax": round(bounds[5], 3),
            },
        },
        "playableBoundsMeters": {
            "xMin": round(playable[0], 3),
            "yMin": round(playable[1], 3),
            "xMax": round(playable[2], 3),
            "yMax": round(playable[3], 3),
        },
        "terrain": {
            "samplesPerAxis": terrain.size,
            "storageTileSize": terrain.tile_size,
            "sampleSpacingMeters": round((terrain.x_spacing + terrain.y_spacing) / 2, 4),
            "playableElevationMeters": {
                "min": round(min(playable_heights), 3),
                "p25": round(percentile(playable_heights, 0.25), 3),
                "median": round(percentile(playable_heights, 0.50), 3),
                "p75": round(percentile(playable_heights, 0.75), 3),
                "max": round(max(playable_heights), 3),
            },
            "playableSlopeDegrees": {
                "mean": round(statistics.fmean(playable_slopes), 3),
                "p90": round(percentile(playable_slopes, 0.90), 3),
                "max": round(max(playable_slopes), 3),
            },
            "coordinateValidation": {
                "method": "SC2 point Z versus bilinear heightmap sampling",
                "sampleCount": len(validation_deltas),
                "meanAbsoluteDeltaMeters": (
                    round(statistics.fmean(validation_deltas), 4) if validation_deltas else 0.0
                ),
                "p90AbsoluteDeltaMeters": (
                    round(percentile(validation_deltas, 0.90), 4) if validation_deltas else 0.0
                ),
            },
        },
        "sceneEvidence": {
            "sceneVersion": scene["$metadata"]["version"],
            "sceneEntityCount": len(entities),
            "featureCounts": dict(sorted(Counter(item["category"] for item in features).items())),
            "battlePoints": points,
        },
        "analysisGrid": {
            "size": f"{grid_size}x{grid_size}",
            "orientation": "A is north/top; 1 is west/left",
            "cells": [round_cell_for_json(cell) for cell in cells],
        },
        "areas": areas,
        "relationships": relationships,
        "spawnSemantics": spawns,
        "confidenceLegend": {
            "EXACT_CLIENT_DATA": "Direct numeric data decoded from client resources.",
            "EXACT_SCENE_DATA": "Direct property or point decoded from SC2.",
            "EXACT_GRID_TOPOLOGY": "Adjacency derived exactly from the declared analysis grid.",
            "NUMERIC_TERRAIN_DERIVATION": "Relationship derived from decoded numeric terrain.",
            "NAME_HEURISTIC": "Category inferred from an asset/entity name; position remains exact.",
            "GRID_RULE_DERIVED": "Area candidate produced by deterministic grid rules.",
            "RULE_DERIVED_CANDIDATE": "Vehicle affordance or risk candidate; requires later validation.",
        },
        "notGeneratedWithoutFurtherEvidence": [
            "CONTROLS",
            "ENABLES_PRESSURE_AGAINST",
            "CROSS_FIRE",
            "GUARANTEED_LINE_OF_SIGHT",
            "GUARANTEED_TRAVERSABLE_ROUTE",
        ],
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    json_path = output_dir / f"{map_id}.semantic.json"
    text_path = output_dir / f"{map_id}.semantic.txt"
    if reviewed_semantics is None and json_path.exists():
        reviewed_semantics = json.loads(json_path.read_text(encoding="utf-8"))
    if reviewed_semantics is not None:
        preserve_reviewed_spawn_sides(spawns, reviewed_semantics, map_id)
    json_path.write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    text_path.write_text(render_llm_text(document), encoding="utf-8")
    return json_path, text_path
