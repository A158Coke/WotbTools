"""Scene facts, map identity and name-based feature classification."""
from __future__ import annotations
import struct
from collections import Counter
from typing import Any, Sequence
from _semanticizer_binary import SemanticizerError



def decode_bytes(value: Any) -> bytes | None:
    if isinstance(value, dict) and isinstance(value.get("$bytes"), str):
        return bytes.fromhex(value["$bytes"])
    return None


def entity_components(entity: dict[str, Any]) -> list[dict[str, Any]]:
    raw = entity.get("components", {})
    return [value for value in raw.values() if isinstance(value, dict)]


def entity_component(entity: dict[str, Any], type_name: str) -> dict[str, Any] | None:
    return next(
        (item for item in entity_components(entity) if item.get("comp.typename") == type_name),
        None,
    )


def entity_position(entity: dict[str, Any]) -> tuple[float, float, float] | None:
    transform = entity_component(entity, "TransformComponent")
    if transform is None:
        return None
    value = transform.get("tc.worldTranslation")
    if not isinstance(value, list) or len(value) != 3:
        return None
    return float(value[0]), float(value[1]), float(value[2])


def entity_labels(entity: dict[str, Any]) -> list[str]:
    label_component = entity_component(entity, "LabelComponent")
    if label_component is None:
        return []
    value = label_component.get("lc.labels", [])
    return [str(label) for label in value] if isinstance(value, list) else []


def entity_properties(entity: dict[str, Any]) -> dict[str, Any]:
    custom = entity_component(entity, "CustomPropertiesComponent")
    if custom is None:
        return {}
    value = custom.get("cpc.properties.archive", {})
    return value if isinstance(value, dict) else {}


def scene_entities(scene: dict[str, Any]) -> list[dict[str, Any]]:
    hierarchy = scene.get("#hierarchy", [])
    if not isinstance(hierarchy, list):
        raise SemanticizerError("SC2 #hierarchy is not an array")
    return [entity for entity in hierarchy if isinstance(entity, dict)]


def world_bounds(entities: Sequence[dict[str, Any]]) -> tuple[float, float, float, float, float, float]:
    for entity in entities:
        if entity.get("name") != "Landscape":
            continue
        render = entity_component(entity, "RenderComponent")
        render_object = render.get("rc.renderObj", {}) if render else {}
        bbox = decode_bytes(render_object.get("bbox")) if isinstance(render_object, dict) else None
        if bbox is not None and len(bbox) == 24:
            return struct.unpack("<6f", bbox)
    raise SemanticizerError("Landscape world bounds are missing from SC2")


def matches_variant(labels: Sequence[str], variant: str | None) -> bool:
    """Variant filter: labeled points must carry the active variant; unlabeled
    scene data (night/reskin maps such as faust_night) is still exact scene data."""
    if variant is None:
        return not labels
    return variant in labels


def map_border(
    entities: Sequence[dict[str, Any]], variant: str | None
) -> tuple[float, float, float, float] | None:
    for entity in entities:
        if not matches_variant(entity_labels(entity), variant):
            continue
        border = entity_component(entity, "MapBorderComponent")
        rect = decode_bytes(border.get("mbc.rect")) if border else None
        if rect is not None and len(rect) == 16:
            return struct.unpack("<4f", rect)
    return None


def battle_points(entities: Sequence[dict[str, Any]], variant: str | None) -> list[dict[str, Any]]:
    result = []
    for entity in entities:
        labels = entity_labels(entity)
        if not matches_variant(labels, variant):
            continue
        props = entity_properties(entity)
        point_type = props.get("type")
        point_position = entity_position(entity)
        if point_type not in ("spawnpoint", "controlpoint", "strategicpoint", "botspawn"):
            continue
        if point_position is None:
            continue
        result.append(
            {
                "name": str(entity.get("name", "unnamed")),
                "type": str(point_type),
                "position": [round(value, 4) for value in point_position],
                "team": props.get("team"),
                "pointNumber": props.get("pointNumber"),
                "preferredVehicleType": props.get("SpawnPreferredVehicleType"),
                "confidence": "EXACT_SCENE_DATA",
            }
        )
    return result


def detect_variant(entities: Sequence[dict[str, Any]]) -> str | None:
    """Pick the variant label with the most battle points (the standard layout
    usually carries the full 32-point set; secondary modes carry fewer)."""
    counter: Counter[str] = Counter()
    for entity in entities:
        props = entity_properties(entity)
        if props.get("type") in ("spawnpoint", "controlpoint", "strategicpoint", "botspawn"):
            counter.update(entity_labels(entity))
    if not counter:
        return None
    return counter.most_common(1)[0][0]


MAP_ID_CODE_ALIASES: dict[str, tuple[str, ...]] = {
    "24_milibase_mlb": ("milbase",),
}


def derive_map_codes(map_id: str, known_codes: Sequence[str]) -> list[str]:
    """Match internal codes (map_names.json keys) to a client map id at token
    boundaries: single-token codes must appear as a token; multi-token codes
    must appear as a contiguous token subsequence."""
    tokens = map_id.split("_")
    result = set(MAP_ID_CODE_ALIASES.get(map_id, ()))
    for code in known_codes:
        code = code.strip().lower()
        if not code:
            continue
        code_tokens = code.split("_")
        if len(code_tokens) == 1:
            if code in tokens:
                result.add(code)
            continue
        for start in range(len(tokens) - len(code_tokens) + 1):
            if tokens[start:start + len(code_tokens)] == code_tokens:
                result.add(code)
                break
    return sorted(result)


def resolve_display_name(
    map_id: str, known_map_names: dict[str, dict[str, str]] | None
) -> str | None:
    """Human-readable map name from map_names.json (en), keyed by the derived
    internal code; returns None for maps not covered by map_names.json."""
    if not known_map_names:
        return None
    codes = derive_map_codes(map_id, known_map_names.keys())
    if not codes:
        return None
    entry = known_map_names.get(codes[0])
    if not isinstance(entry, dict) or not entry.get("en"):
        return None
    return str(entry["en"])


def classify_feature(name: str) -> str | None:
    value = name.lower().replace("\\", "/")
    if value.startswith("snd_") or "_fx" in value or "dust" in value:
        return None
    if any(token in value for token in ("tent", "beduin")):
        return "soft_cover"
    if any(token in value for token in ("bridge", "estacade", "viaduct")):
        return "bridge"
    if any(token in value for token in ("rails", "railroad", "locomotive", "carriage", "train")):
        return "railway"
    if any(token in value for token in ("bld_", "building", "house", "mosque", "bazaar", "hangar")):
        return "building"
    if any(token in value for token in ("wall", "fence", "fortification")):
        return "wall"
    if any(token in value for token in ("ruin", "blocking_volume", "block", "barrier", "rock")):
        return "obstacle"
    if any(token in value for token in ("bush", "palm", "tree", "grass", "shrub")):
        return "vegetation"
    return None


def scene_features(
    entities: Sequence[dict[str, Any]],
    bounds: tuple[float, float, float, float, float, float],
) -> list[dict[str, Any]]:
    result = []
    for entity in entities:
        name = str(entity.get("name", ""))
        category = classify_feature(name)
        point = entity_position(entity)
        if category is None or point is None:
            continue
        x, y, z = point
        if not (bounds[0] <= x <= bounds[3] and bounds[1] <= y <= bounds[4]):
            continue
        result.append(
            {
                "name": name,
                "category": category,
                "position": [round(x, 4), round(y, 4), round(z, 4)],
                "confidence": "NAME_HEURISTIC_WITH_EXACT_POSITION",
            }
        )
    return result
