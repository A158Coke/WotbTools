"""Generate evidence-backed WoT Blitz map semantics from DAVA client resources.

The script is intentionally deterministic. It reads the scene and heightmap,
builds auditable regions, and emits both JSON and compact Chinese text for an
LLM. It never calls an LLM and does not invent tactical routes.

Supported input:
  * one unpacked map directory;
  * one map directory whose resources still end in .dvpl;
  * a ZIP containing one map directory.

No third-party Python package is required.
"""
from _semanticizer_binary import (
    DVPL_FOOTER, SemanticizerError,
    Reader, decode_dvpl, lz4_block_decompress, read_resource,
)
from _semanticizer_keyed_archive import (
    TYPE_AABBOX3, TYPE_ARRAY, TYPE_BOOLEAN, TYPE_BYTE_ARRAY, TYPE_COLOR,
    TYPE_FASTNAME, TYPE_FILEPATH, TYPE_FLOAT, TYPE_FLOAT64, TYPE_INT16,
    TYPE_INT32, TYPE_INT64, TYPE_INT8, TYPE_KEYED_ARCHIVE, TYPE_MATRIX2,
    TYPE_MATRIX3, TYPE_MATRIX4, TYPE_NONE, TYPE_STRING, TYPE_TRANSFORM,
    TYPE_UINT16, TYPE_UINT32, TYPE_UINT64, TYPE_UINT8, TYPE_VECTOR2,
    TYPE_VECTOR3, TYPE_VECTOR4, TYPE_WIDE_STRING, read_archive, read_ka_value,
    read_sc2, table_value,
)
from _semanticizer_scene import (
    MAP_ID_CODE_ALIASES, battle_points, classify_feature, decode_bytes, derive_map_codes,
    detect_variant, entity_component, entity_components, entity_labels,
    entity_position, entity_properties, map_border, matches_variant,
    resolve_display_name, scene_entities, scene_features, world_bounds,
)
from _semanticizer_terrain import (
    NINE_GRID_HALF_EXTENT, NINE_GRID_SIZE, Terrain, build_cells, cell_id,
    load_heightmap, nine_grid_region, percentile, raster_window, sample_height,
    window_values,
)
from _semanticizer_areas import (
    CLASS_LABELS, aggregate_area_tags, area_affordances, area_characteristics,
    build_areas, direction_label,
)
from _semanticizer_relationships import (
    build_relationships, build_spawn_semantics, cell_at_position,
    coordinate_validation_passed, preserve_reviewed_spawn_sides,
)
from _semanticizer_resources import (
    discover_map_resources, infer_map_id, normalized_resource_suffix,
)
from _semanticizer_output import render_llm_text, round_cell_for_json
from _semanticizer_pipeline import SCHEMA_VERSION, semanticize
from _semanticizer_cli import build_parser, load_map_names, main

if __name__ == "__main__":
    raise SystemExit(main())
