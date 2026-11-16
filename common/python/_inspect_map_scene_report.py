"""Whole-scene inspection report assembly."""
from __future__ import annotations
import zipfile
from collections import Counter, defaultdict
from typing import Any
from wotb_sc2 import entity_components
from _inspect_map_archive import iter_entities_recursive, normalize_member, suffix_key
from _inspect_map_data import (
    TARGET_COMPONENT_TYPES, add_sample, byte_payload, inspect_data_nodes,
    is_resource_reference, iter_render_batches, summarize_value, walk,
)

def inspect_scene(scene: dict[str, Any], scene_member: zipfile.ZipInfo, sample_limit: int) -> dict[str, Any]:
    entities = list(iter_entities_recursive(scene))
    component_counts: Counter[str] = Counter()
    component_key_counts: dict[str, Counter[str]] = defaultdict(Counter)
    target_component_samples: dict[str, list[dict[str, Any]]] = defaultdict(list)
    entity_name_samples: list[str] = []
    render_component_keys: Counter[str] = Counter()
    render_object_keys: Counter[str] = Counter()
    render_object_value_types: Counter[str] = Counter()
    render_object_class_counts: Counter[str] = Counter()
    render_batch_keys: Counter[str] = Counter()
    render_batch_value_types: Counter[str] = Counter()
    render_batch_samples: list[dict[str, Any]] = []
    detail_limit = min(sample_limit, 6)

    for entity_index, (entity_path, entity) in enumerate(entities):
        name = entity.get("name")
        if isinstance(name, str):
            add_sample(entity_name_samples, name, sample_limit)
        for component in entity_components(entity):
            type_name = str(component.get("comp.typename", "<unknown>"))
            component_counts[type_name] += 1
            for key in component:
                component_key_counts[type_name][str(key)] += 1
            if type_name in TARGET_COMPONENT_TYPES:
                add_sample(
                    target_component_samples[type_name],
                    {
                        "entityIndex": entity_index,
                        "entityPath": entity_path,
                        "entityName": name,
                        "component": summarize_value(component),
                    },
                    detail_limit,
                )

            if type_name != "RenderComponent":
                continue
            for key in component:
                render_component_keys[str(key)] += 1
            render_object = component.get("rc.renderObj")
            if not isinstance(render_object, dict):
                continue
            render_object_class_counts[str(render_object.get("##name", "<unknown>"))] += 1
            for key, value in render_object.items():
                render_object_keys[str(key)] += 1
                render_object_value_types[f"{key}:{type(value).__name__}"] += 1
            for batch in iter_render_batches(render_object):
                for key, value in batch.items():
                    render_batch_keys[str(key)] += 1
                    render_batch_value_types[f"{key}:{type(value).__name__}"] += 1
                add_sample(render_batch_samples, summarize_value(batch), detail_limit)

    reference_counts: Counter[str] = Counter()
    references_by_extension: dict[str, list[str]] = defaultdict(list)
    reference_paths: dict[str, list[str]] = defaultdict(list)
    binary_field_count = 0
    binary_total_bytes = 0
    binary_key_counts: Counter[str] = Counter()
    binary_key_bytes: Counter[str] = Counter()
    binary_samples: list[dict[str, Any]] = []
    string_samples: list[dict[str, str]] = []

    for path, value in walk(scene):
        if isinstance(value, str):
            if is_resource_reference(value):
                normalized = value.replace("\\", "/")
                extension = suffix_key(normalized)
                reference_counts[extension] += 1
                if normalized not in references_by_extension[extension]:
                    add_sample(references_by_extension[extension], normalized, sample_limit)
                add_sample(reference_paths[normalized], path, 3)
            elif ("render" in path.lower() or "polygon" in path.lower()) and value:
                add_sample(string_samples, {"path": path, "value": value}, sample_limit)
        else:
            payload = byte_payload(value)
            if payload is None:
                continue
            size = len(payload)
            binary_field_count += 1
            binary_total_bytes += size
            terminal_key = path.rsplit(".", 1)[-1]
            binary_key_counts[terminal_key] += 1
            binary_key_bytes[terminal_key] += size
            add_sample(
                binary_samples,
                {
                    "path": path,
                    "bytes": size,
                    "prefixHex": payload[:16].hex(),
                },
                sample_limit,
            )

    unique_references = [
        {
            "value": value,
            "extension": suffix_key(value),
            "paths": paths,
        }
        for value, paths in sorted(reference_paths.items())
    ]

    return {
        "schemaVersion": 3,
        "sceneMember": normalize_member(scene_member.filename),
        "sceneCompressedBytes": scene_member.compress_size,
        "sceneStoredBytes": scene_member.file_size,
        "sceneMetadata": scene.get("$metadata", {}),
        "sceneTraversal": {
            "mode": "recursive #hierarchy",
            "entityCount": len(entities),
        },
        "entityCount": len(entities),
        "entityNameSamples": entity_name_samples,
        "componentTypeCounts": dict(component_counts.most_common()),
        "componentKeyCountsByType": {
            type_name: dict(component_key_counts[type_name].most_common())
            for type_name in TARGET_COMPONENT_TYPES
            if type_name in component_key_counts
        },
        "targetComponentSamples": {
            key: value for key, value in target_component_samples.items()
        },
        "renderComponentKeyCounts": dict(render_component_keys.most_common()),
        "renderObjectClassCounts": dict(render_object_class_counts.most_common()),
        "renderObjectKeyCounts": dict(render_object_keys.most_common()),
        "renderObjectValueTypeCounts": dict(render_object_value_types.most_common()),
        "renderBatchKeyCounts": dict(render_batch_keys.most_common()),
        "renderBatchValueTypeCounts": dict(render_batch_value_types.most_common()),
        "renderBatchSamples": render_batch_samples,
        "dataNodes": inspect_data_nodes(scene, sample_limit),
        "resourceReferences": {
            "countByExtension": dict(reference_counts.most_common()),
            "samplesByExtension": dict(sorted(references_by_extension.items())),
            "unique": unique_references,
        },
        "binaryFields": {
            "count": binary_field_count,
            "totalDecodedBytes": binary_total_bytes,
            "countByTerminalKey": dict(binary_key_counts.most_common()),
            "bytesByTerminalKey": dict(binary_key_bytes.most_common()),
            "samples": binary_samples,
        },
        "renderRelatedStringSamples": string_samples,
        "interpretationRule": (
            "SC2 fields and decoded PolygonGroup metadata are exact format evidence. "
            "Entity/component/render statistics recursively traverse the complete #hierarchy. "
            "CollisionTypeComponent and TerrainDataComponent fields are reported exactly, but "
            "opaque auxiliary payloads remain UNKNOWN until decoded. External DAVA source documents "
            "PolygonGroup vertices/indices layout; actual client vertexFormat still needs decoding."
        ),
    }
