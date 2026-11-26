"""Area aggregation over the derived analysis grid."""
from __future__ import annotations
import math
import statistics
from collections import Counter, deque
from typing import Any, Sequence


CLASS_LABELS = {
    "HARD_COVER_ZONE": "硬掩体密集区",
    "LINEAR_CORRIDOR": "线性通道",
    "ELEVATED_TERRAIN": "高地区域",
    "VEGETATED_TERRAIN": "植被密集区",
    "LOW_TERRAIN": "低地区域",
    "MIXED_TERRAIN": "混合地形连接区",
}


def direction_label(
    x: float,
    y: float,
    playable: tuple[float, float, float, float],
) -> str:
    center_x = (playable[0] + playable[2]) / 2
    center_y = (playable[1] + playable[3]) / 2
    nx = (x - center_x) / max(1.0, playable[2] - playable[0])
    ny = (y - center_y) / max(1.0, playable[3] - playable[1])
    horizontal = "东" if nx > 0.16 else "西" if nx < -0.16 else ""
    vertical = "北" if ny > 0.16 else "南" if ny < -0.16 else ""
    return (horizontal + vertical + "侧") if (horizontal or vertical) else "中央"


def area_characteristics(area: dict[str, Any]) -> list[str]:
    tags = set(area["types"])
    evidence = area["evidence"]
    result = [
        f"覆盖网格 {', '.join(area['gridCells'])}",
        (
            f"平均高程 {evidence['meanElevationMeters']:.2f} 米，"
            f"平均坡度 {evidence['meanSlopeDegrees']:.2f}°，"
            f"90 分位坡度 {evidence['p90SlopeDegrees']:.2f}°"
        ),
    ]
    if "HARD_COVER_DENSE" in tags:
        result.append("客户端场景对象名称显示该区域建筑/围墙型硬掩体密集")
    elif "HARD_COVER_PRESENT" in tags:
        result.append("客户端场景对象名称显示该区域存在建筑、围墙或障碍物")
    if "LINEAR_CORRIDOR" in tags:
        result.append("线性基础设施对象连续出现，构成通道候选")
    if "ELEVATED" in tags:
        result.append("区域平均高程处于可玩区高位分组")
    if "LOW_GROUND" in tags:
        result.append("区域平均高程处于可玩区低位分组")
    if "RIDGE_CANDIDATE" in tags:
        result.append("高程与局部起伏同时较高，存在山脊地形候选")
    if "OPEN_GROUND_CANDIDATE" in tags:
        result.append("已识别的建筑、障碍物与植被对象较少，属于开放地候选")
    if "VEGETATION_DENSE" in tags:
        result.append("客户端场景中植被对象相对密集")
    return result


def area_affordances(types: set[str]) -> tuple[list[str], list[str]]:
    """Rule-derived candidates, deliberately separate from exact facts."""
    favors: list[str] = []
    risks: list[str] = []
    if "HARD_COVER_DENSE" in types:
        favors.extend(("ARMORED_HEAVY", "SIDESCRAPE_VEHICLE", "HIGH_ALPHA_TRADER"))
        risks.append("建筑密集可能限制横向机动和转场速度")
    if "ELEVATED" in types and "STEEP" not in types:
        favors.append("MOBILE_VEHICLE")
    if "RIDGE_CANDIDATE" in types:
        favors.append("HULL_DOWN_VEHICLE")
        risks.append("低机动车辆进入高地区域的成本可能更高")
    if "OPEN_GROUND_CANDIDATE" in types:
        favors.append("MOBILE_VEHICLE")
        risks.append("缺乏已识别掩体；暴露风险需要视线计算进一步确认")
    if "VEGETATION_DENSE" in types and "HARD_COVER_DENSE" not in types:
        favors.append("CAMOUFLAGE_DEPENDENT_SUPPORT")
        risks.append("植被不等于实体防护，无法阻挡炮弹")
    if "STEEP" in types:
        risks.append("局部陡坡可能限制低机动或俯仰能力较差的车辆")
    return list(dict.fromkeys(favors)), list(dict.fromkeys(risks))


def aggregate_area_tags(component_cells: Sequence[dict[str, Any]]) -> list[str]:
    """Collapse mutually exclusive cell labels into one coherent area profile."""
    tag_counts = Counter(tag for cell in component_cells for tag in cell["semanticTags"])
    count = len(component_cells)
    result: list[str] = []

    for mutually_exclusive in (
        ("ELEVATED", "MID_ELEVATION", "LOW_GROUND"),
        ("FLAT", "ROLLING", "STEEP"),
    ):
        winner = max(mutually_exclusive, key=lambda tag: (tag_counts[tag], -mutually_exclusive.index(tag)))
        if tag_counts[winner] > 0:
            result.append(winner)

    for tag in (
        "RIDGE_CANDIDATE",
        "HARD_COVER_DENSE",
        "URBAN_CANDIDATE",
        "HARD_COVER_PRESENT",
        "LINEAR_CORRIDOR",
        "VEGETATION_DENSE",
        "OPEN_GROUND_CANDIDATE",
    ):
        if tag_counts[tag] >= math.ceil(count / 2):
            result.append(tag)

    dominant = component_cells[0]["dominantClass"]
    defining_tag = {
        "HARD_COVER_ZONE": "HARD_COVER_DENSE",
        "LINEAR_CORRIDOR": "LINEAR_CORRIDOR",
        "ELEVATED_TERRAIN": "ELEVATED",
        "VEGETATED_TERRAIN": "VEGETATION_DENSE",
        "LOW_TERRAIN": "LOW_GROUND",
    }.get(dominant)
    if defining_tag and defining_tag not in result:
        result.append(defining_tag)
    return result


def build_areas(
    cells: Sequence[dict[str, Any]],
    playable: tuple[float, float, float, float],
    grid_size: int,
) -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    by_position = {(cell["row"], cell["column"]): cell for cell in cells}
    seen: set[tuple[int, int]] = set()
    components: list[list[dict[str, Any]]] = []
    for cell in cells:
        start = (cell["row"], cell["column"])
        if start in seen:
            continue
        seen.add(start)
        queue = deque([start])
        component_cells = []
        while queue:
            current = queue.popleft()
            current_cell = by_position[current]
            component_cells.append(current_cell)
            for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                neighbor_key = (current[0] + dr, current[1] + dc)
                neighbor = by_position.get(neighbor_key)
                if neighbor is None or neighbor_key in seen:
                    continue
                if neighbor["dominantClass"] == cell["dominantClass"]:
                    seen.add(neighbor_key)
                    queue.append(neighbor_key)
        components.append(component_cells)

    counters: Counter[str] = Counter()
    areas: dict[str, dict[str, Any]] = {}
    cell_to_area = {}
    for component_cells in components:
        dominant = component_cells[0]["dominantClass"]
        counters[dominant] += 1
        area_id = f"{dominant}_{counters[dominant]:02d}"
        grid_cells = sorted(cell["id"] for cell in component_cells)
        x_min = min(cell["bounds"][0] for cell in component_cells)
        y_min = min(cell["bounds"][1] for cell in component_cells)
        x_max = max(cell["bounds"][2] for cell in component_cells)
        y_max = max(cell["bounds"][3] for cell in component_cells)
        center_x = statistics.fmean((cell["bounds"][0] + cell["bounds"][2]) / 2 for cell in component_cells)
        center_y = statistics.fmean((cell["bounds"][1] + cell["bounds"][3]) / 2 for cell in component_cells)
        all_tags = aggregate_area_tags(component_cells)
        feature_counts: Counter[str] = Counter()
        for cell in component_cells:
            feature_counts.update(cell["featureCounts"])
        evidence = {
            "meanElevationMeters": round(
                statistics.fmean(cell["meanElevationMeters"] for cell in component_cells), 3
            ),
            "minElevationMeters": round(min(cell["minElevationMeters"] for cell in component_cells), 3),
            "maxElevationMeters": round(max(cell["maxElevationMeters"] for cell in component_cells), 3),
            "meanSlopeDegrees": round(
                statistics.fmean(cell["meanSlopeDegrees"] for cell in component_cells), 3
            ),
            "p90SlopeDegrees": round(max(cell["p90SlopeDegrees"] for cell in component_cells), 3),
            "featureCounts": dict(sorted(feature_counts.items())),
        }
        favors, risks = area_affordances(set(all_tags))
        area = {
            "label": direction_label(center_x, center_y, playable) + CLASS_LABELS[dominant],
            "types": all_tags,
            "gridCells": grid_cells,
            "gridRegions": sorted(
                {cell["nineGridRegion"] for cell in component_cells}
            ),
            "boundsMeters": {
                "xMin": round(x_min, 2),
                "yMin": round(y_min, 2),
                "xMax": round(x_max, 2),
                "yMax": round(y_max, 2),
            },
            "evidence": evidence,
            "characteristics": [],
            "favors": favors,
            "risks": risks,
            "confidence": {
                "geometry": "EXACT_CLIENT_DATA",
                "objectPositions": "EXACT_CLIENT_DATA",
                "objectCategories": "NAME_HEURISTIC",
                "areaBoundary": "GRID_RULE_DERIVED",
                "favorsAndRisks": "RULE_DERIVED_CANDIDATE",
            },
        }
        area["characteristics"] = area_characteristics({**area, "id": area_id})
        areas[area_id] = area
        for cell in component_cells:
            cell_to_area[cell["id"]] = area_id
    return areas, cell_to_area
