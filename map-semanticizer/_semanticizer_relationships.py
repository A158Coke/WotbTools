"""Grid topology relationships, spawn facts and coordinate checks."""
from __future__ import annotations
import statistics
from collections import Counter, defaultdict
from typing import Any, Sequence
from _semanticizer_terrain import cell_id


def cell_at_position(
    x: float,
    y: float,
    playable: tuple[float, float, float, float],
    grid_size: int,
) -> str | None:
    if not (playable[0] <= x <= playable[2] and playable[1] <= y <= playable[3]):
        return None
    column = min(grid_size - 1, int((x - playable[0]) / (playable[2] - playable[0]) * grid_size))
    row = min(grid_size - 1, int((y - playable[1]) / (playable[3] - playable[1]) * grid_size))
    return cell_id(row, column, grid_size)


def build_relationships(
    cells: Sequence[dict[str, Any]],
    areas: dict[str, dict[str, Any]],
    cell_to_area: dict[str, str],
    points: Sequence[dict[str, Any]],
    playable: tuple[float, float, float, float],
    grid_size: int,
) -> list[dict[str, Any]]:
    by_position = {(cell["row"], cell["column"]): cell for cell in cells}
    shared_edges: Counter[tuple[str, str]] = Counter()
    for cell in cells:
        for dr, dc in ((1, 0), (0, 1)):
            neighbor = by_position.get((cell["row"] + dr, cell["column"] + dc))
            if neighbor is None:
                continue
            left, right = cell_to_area[cell["id"]], cell_to_area[neighbor["id"]]
            if left != right:
                shared_edges[tuple(sorted((left, right)))] += 1

    relationships: list[dict[str, Any]] = []
    for (left, right), edge_count in sorted(shared_edges.items()):
        relationships.append(
            {
                "from": left,
                "type": "ADJACENT_TO",
                "to": right,
                "reason": f"两个区域在 {edge_count} 条分析网格边上直接相邻",
                "confidence": "EXACT_GRID_TOPOLOGY",
            }
        )
        left_height = areas[left]["evidence"]["meanElevationMeters"]
        right_height = areas[right]["evidence"]["meanElevationMeters"]
        delta = left_height - right_height
        if abs(delta) >= 2.5:
            higher, lower = (left, right) if delta > 0 else (right, left)
            relationships.append(
                {
                    "from": higher,
                    "type": "HIGHER_THAN",
                    "to": lower,
                    "reason": f"相邻区域平均高程差 {abs(delta):.2f} 米",
                    "confidence": "NUMERIC_TERRAIN_DERIVATION",
                }
            )

    for point in points:
        if point["type"] not in ("controlpoint", "strategicpoint"):
            continue
        point_cell = cell_at_position(
            point["position"][0], point["position"][1], playable, grid_size
        )
        if point_cell is None:
            continue
        area = cell_to_area[point_cell]
        relationship_type = (
            "CONTAINS_CONTROL_POINT"
            if point["type"] == "controlpoint"
            else "CONTAINS_STRATEGIC_POINT"
        )
        relationships.append(
            {
                "from": area,
                "type": relationship_type,
                "to": point["name"],
                "reason": f"{point['name']} 的 SC2 坐标位于网格 {point_cell}",
                "confidence": "EXACT_SCENE_DATA",
            }
        )
    return relationships


def build_spawn_semantics(
    points: Sequence[dict[str, Any]],
    playable: tuple[float, float, float, float],
    grid_size: int,
    cell_to_area: dict[str, str],
) -> dict[str, Any]:
    grouped: dict[Any, list[dict[str, Any]]] = defaultdict(list)
    for point in points:
        if point["type"] == "spawnpoint":
            grouped[point.get("team")].append(point)
    result = {}
    for team, spawns in sorted(grouped.items(), key=lambda item: str(item[0])):
        center_x = statistics.fmean(point["position"][0] for point in spawns)
        center_y = statistics.fmean(point["position"][1] for point in spawns)
        center_z = statistics.fmean(point["position"][2] for point in spawns)
        cells = sorted(
            {
                candidate
                for point in spawns
                if (candidate := cell_at_position(
                    point["position"][0], point["position"][1], playable, grid_size
                )) is not None
            }
        )
        result[f"TEAM_{team}"] = {
            "status": "EXACT_SCENE_DATA",
            "spawnCount": len(spawns),
            "centroidMeters": {
                "x": round(center_x, 3),
                "y": round(center_y, 3),
                "z": round(center_z, 3),
            },
            "gridCells": cells,
            "areas": sorted({cell_to_area[cell] for cell in cells}),
        }
    if not result:
        return {
            "TEAM_A": {"status": "UNKNOWN"},
            "TEAM_B": {"status": "UNKNOWN"},
        }
    return result


def preserve_reviewed_spawn_sides(
    spawns: dict[str, Any], reviewed: dict[str, Any], map_id: str,
) -> None:
    """只接收同地图已审校的互补方向，不从坐标/scene team 编号推断。"""
    groups = reviewed.get("spawnSemantics", {})
    sides = {key: value["physicalSide"] for key, value in groups.items()
             if "physicalSide" in value}
    if not sides:
        return
    opposite = {"NORTH": "SOUTH", "SOUTH": "NORTH", "WEST": "EAST", "EAST": "WEST"}
    if (reviewed.get("mapId") != map_id
            or set(sides) != {"TEAM_1", "TEAM_2"}
            or sides["TEAM_1"] not in opposite
            or opposite[sides["TEAM_1"]] != sides["TEAM_2"]
            or any(key not in spawns or spawns[key].get("status") != "EXACT_SCENE_DATA"
                   for key in sides)):
        raise ValueError("已审校出生方向必须来自同地图且为完整互补侧")
    for key, side in sides.items():
        spawns[key]["physicalSide"] = side


def coordinate_validation_passed(terrain: dict[str, Any]) -> bool:
    """Robust Z-axis validation rule for generated documents.

    Uses the P90 absolute delta (resilient to a few elevated spawn/control
    points), not the mean: e.g. 24_milibase_mlb has MAE=1.45 m while its
    P90 is 0.08 m — the heightmap itself is fine and must not be rejected.
    """
    validation = terrain.get("coordinateValidation", {})
    sample_count = validation.get("sampleCount", 0)
    p90 = validation.get("p90AbsoluteDeltaMeters")
    if not sample_count or p90 is None:
        return False
    return float(p90) <= 0.5
