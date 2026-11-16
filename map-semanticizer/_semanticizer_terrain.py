"""Heightmap sampling and deterministic grid-cell derivation."""
from __future__ import annotations
import math
import statistics
import struct
import sys
from array import array
from collections import Counter
from dataclasses import dataclass
from typing import Any, Sequence
from _semanticizer_binary import SemanticizerError


NINE_GRID_HALF_EXTENT = 250.0


NINE_GRID_SIZE = 500.0


@dataclass(frozen=True)
class Terrain:
    size: int
    tile_size: int
    heights: list[float]
    slopes: list[float]
    x_spacing: float
    y_spacing: float


def load_heightmap(
    raw: bytes, bounds: tuple[float, float, float, float, float, float]
) -> Terrain:
    if len(raw) < 8:
        raise SemanticizerError("Heightmap is too small")
    size, tile_size = struct.unpack_from("<II", raw)
    if tile_size <= 0 or size <= 0 or size % tile_size:
        raise SemanticizerError(f"Unexpected heightmap header: size={size}, tile={tile_size}")
    if len(raw) != 8 + size * size * 2:
        raise SemanticizerError(
            f"Unexpected heightmap size: header={size}x{size}, bytes={len(raw)}"
        )
    values = array("H")
    values.frombytes(raw[8:])
    if sys.byteorder != "little":
        values.byteswap()

    block_count = size // tile_size
    untiled = [0] * (size * size)
    source_index = 0
    for block_y in range(block_count):
        for block_x in range(block_count):
            for local_y in range(tile_size):
                destination = (block_y * tile_size + local_y) * size + block_x * tile_size
                untiled[destination:destination + tile_size] = values[
                    source_index:source_index + tile_size
                ]
                source_index += tile_size

    z_min, z_max = bounds[2], bounds[5]
    z_scale = (z_max - z_min) / 65535.0
    heights = [z_min + value * z_scale for value in untiled]
    x_spacing = (bounds[3] - bounds[0]) / size
    y_spacing = (bounds[4] - bounds[1]) / size
    slopes = [0.0] * (size * size)
    for y in range(size):
        y0, y1 = max(0, y - 1), min(size - 1, y + 1)
        dy_distance = max(y_spacing, (y1 - y0) * y_spacing)
        row = y * size
        for x in range(size):
            x0, x1 = max(0, x - 1), min(size - 1, x + 1)
            dx_distance = max(x_spacing, (x1 - x0) * x_spacing)
            dzdx = (heights[row + x1] - heights[row + x0]) / dx_distance
            dzdy = (heights[y1 * size + x] - heights[y0 * size + x]) / dy_distance
            slopes[row + x] = math.degrees(math.atan(math.hypot(dzdx, dzdy)))
    return Terrain(size, tile_size, heights, slopes, x_spacing, y_spacing)


def percentile(values: Sequence[float], fraction: float) -> float:
    if not values:
        raise SemanticizerError("Cannot calculate a percentile of an empty sequence")
    ordered = sorted(values)
    index = fraction * (len(ordered) - 1)
    lower = math.floor(index)
    upper = math.ceil(index)
    if lower == upper:
        return float(ordered[lower])
    weight = index - lower
    return float(ordered[lower] * (1.0 - weight) + ordered[upper] * weight)


def raster_window(
    rect: tuple[float, float, float, float],
    bounds: tuple[float, float, float, float, float, float],
    size: int,
) -> tuple[int, int, int, int]:
    x_min, x_max = sorted((rect[0], rect[2]))
    y_min, y_max = sorted((rect[1], rect[3]))
    ix0 = max(0, min(size - 1, int((x_min - bounds[0]) / (bounds[3] - bounds[0]) * size)))
    ix1 = max(ix0 + 1, min(size, math.ceil((x_max - bounds[0]) / (bounds[3] - bounds[0]) * size)))
    iy0 = max(0, min(size - 1, int((y_min - bounds[1]) / (bounds[4] - bounds[1]) * size)))
    iy1 = max(iy0 + 1, min(size, math.ceil((y_max - bounds[1]) / (bounds[4] - bounds[1]) * size)))
    return ix0, iy0, ix1, iy1


def window_values(data: Sequence[float], size: int, window: tuple[int, int, int, int]) -> list[float]:
    x0, y0, x1, y1 = window
    return [data[y * size + x] for y in range(y0, y1) for x in range(x0, x1)]


def sample_height(
    terrain: Terrain,
    bounds: tuple[float, float, float, float, float, float],
    x: float,
    y: float,
) -> float:
    # DAVA maps world positions to sample coordinates with x / size and y / size.
    sx = (x - bounds[0]) / (bounds[3] - bounds[0]) * terrain.size
    sy = (y - bounds[1]) / (bounds[4] - bounds[1]) * terrain.size
    sx = max(0.0, min(terrain.size - 1.0, sx))
    sy = max(0.0, min(terrain.size - 1.0, sy))
    x0, y0 = int(math.floor(sx)), int(math.floor(sy))
    x1, y1 = min(terrain.size - 1, x0 + 1), min(terrain.size - 1, y0 + 1)
    tx, ty = sx - x0, sy - y0
    h00 = terrain.heights[y0 * terrain.size + x0]
    h10 = terrain.heights[y0 * terrain.size + x1]
    h01 = terrain.heights[y1 * terrain.size + x0]
    h11 = terrain.heights[y1 * terrain.size + x1]
    return (
        h00 * (1 - tx) * (1 - ty)
        + h10 * tx * (1 - ty)
        + h01 * (1 - tx) * ty
        + h11 * tx * ty
    )


def cell_id(row_from_south: int, column: int, grid_size: int) -> str:
    return f"{chr(ord('A') + grid_size - row_from_south - 1)}{column + 1}"


def build_cells(
    terrain: Terrain,
    bounds: tuple[float, float, float, float, float, float],
    playable: tuple[float, float, float, float],
    features: Sequence[dict[str, Any]],
    grid_size: int,
) -> list[dict[str, Any]]:
    playable_heights = window_values(
        terrain.heights, terrain.size, raster_window(playable, bounds, terrain.size)
    )
    low_elevation = percentile(playable_heights, 0.33)
    high_elevation = percentile(playable_heights, 0.67)
    x_step = (playable[2] - playable[0]) / grid_size
    y_step = (playable[3] - playable[1]) / grid_size
    cells = []
    for row in range(grid_size):
        for column in range(grid_size):
            rect = (
                playable[0] + column * x_step,
                playable[1] + row * y_step,
                playable[0] + (column + 1) * x_step,
                playable[1] + (row + 1) * y_step,
            )
            window = raster_window(rect, bounds, terrain.size)
            elevations = window_values(terrain.heights, terrain.size, window)
            slopes = window_values(terrain.slopes, terrain.size, window)
            selected = [
                feature
                for feature in features
                if rect[0] <= feature["position"][0] < rect[2]
                and rect[1] <= feature["position"][1] < rect[3]
            ]
            counts = Counter(feature["category"] for feature in selected)
            mean_elevation = statistics.fmean(elevations)
            cells.append(
                {
                    "id": cell_id(row, column, grid_size),
                    "row": row,
                    "column": column,
                    "bounds": rect,
                    "nineGridRegion": nine_grid_region(
                        (rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2
                    ),
                    "meanElevationMeters": mean_elevation,
                    "minElevationMeters": min(elevations),
                    "maxElevationMeters": max(elevations),
                    "meanSlopeDegrees": statistics.fmean(slopes),
                    "p90SlopeDegrees": percentile(slopes, 0.90),
                    "featureCounts": counts,
                    "elevationBand": (
                        "LOW" if mean_elevation < low_elevation
                        else "HIGH" if mean_elevation > high_elevation
                        else "MID"
                    ),
                }
            )

    building_scores = [
        cell["featureCounts"]["building"] + cell["featureCounts"]["wall"]
        for cell in cells
    ]
    vegetation_counts = [cell["featureCounts"]["vegetation"] for cell in cells]
    nonzero_buildings = [value for value in building_scores if value > 0]
    nonzero_vegetation = [value for value in vegetation_counts if value > 0]
    building_dense_threshold = max(
        3, math.ceil(percentile(nonzero_buildings, 0.60)) if nonzero_buildings else 3
    )
    vegetation_dense_threshold = max(
        3, math.ceil(percentile(nonzero_vegetation, 0.60)) if nonzero_vegetation else 3
    )

    for cell, building_score in zip(cells, building_scores, strict=True):
        counts: Counter[str] = cell["featureCounts"]
        tags = []
        if cell["elevationBand"] == "HIGH":
            tags.append("ELEVATED")
        elif cell["elevationBand"] == "LOW":
            tags.append("LOW_GROUND")
        else:
            tags.append("MID_ELEVATION")

        mean_slope = cell["meanSlopeDegrees"]
        relief = cell["maxElevationMeters"] - cell["minElevationMeters"]
        if mean_slope >= 14 or cell["p90SlopeDegrees"] >= 24:
            tags.append("STEEP")
        elif mean_slope >= 6:
            tags.append("ROLLING")
        else:
            tags.append("FLAT")
        if cell["elevationBand"] == "HIGH" and relief >= 5:
            tags.append("RIDGE_CANDIDATE")
        if building_score >= building_dense_threshold:
            tags.extend(("HARD_COVER_DENSE", "URBAN_CANDIDATE"))
        elif building_score > 0 or counts["obstacle"] >= 4:
            tags.append("HARD_COVER_PRESENT")
        if counts["railway"] >= 2:
            tags.append("LINEAR_CORRIDOR")
        if counts["vegetation"] >= vegetation_dense_threshold:
            tags.append("VEGETATION_DENSE")
        tangible_cover = building_score + counts["obstacle"] + counts["bridge"]
        if tangible_cover <= 1 and counts["vegetation"] <= 1:
            tags.append("OPEN_GROUND_CANDIDATE")

        if "HARD_COVER_DENSE" in tags:
            dominant = "HARD_COVER_ZONE"
        elif "LINEAR_CORRIDOR" in tags:
            dominant = "LINEAR_CORRIDOR"
        elif "ELEVATED" in tags:
            dominant = "ELEVATED_TERRAIN"
        elif "VEGETATION_DENSE" in tags:
            dominant = "VEGETATED_TERRAIN"
        elif "LOW_GROUND" in tags:
            dominant = "LOW_TERRAIN"
        else:
            dominant = "MIXED_TERRAIN"
        cell["semanticTags"] = tags
        cell["dominantClass"] = dominant
        cell["featureCounts"] = dict(sorted(counts.items()))
    return cells


def nine_grid_region(x_mid: float, y_mid: float) -> int:
    """GRID_REGION_1~9 for a semantic-grid cell center, using the backend
    MapRegionResolver convention (canonical 0..500 = raw ±250 m)."""
    cx = min(max(x_mid + NINE_GRID_HALF_EXTENT, 0.0), NINE_GRID_SIZE)
    cy = min(max(y_mid + NINE_GRID_HALF_EXTENT, 0.0), NINE_GRID_SIZE)
    third = NINE_GRID_SIZE / 3.0
    if cx < third:
        column = 0
    elif cx < 2.0 * third:
        column = 1
    else:
        column = 2
    if cy > NINE_GRID_SIZE - third:
        row = 0
    elif cy > NINE_GRID_SIZE - 2.0 * third:
        row = 1
    else:
        row = 2
    return row * 3 + column + 1
