#!/usr/bin/env python3
"""Safely sync the WotB equipment catalog from reviewed BlitzKit sources.

The updater deliberately separates two classes of equipment:

* FULLY_MODELED_CODES: every catalog effect for the item is derived from a
  reviewed BlitzKit calculation source.
* LOCKED_CODES: WotBTools models the item, but BlitzKit does not expose every
  effect through calculation code. These items are never partially rewritten;
  their reviewed description-template fingerprints and reviewed game version
  are enforced by validate_locked_equipment_contract.py.

The workflow also validates all equipment referenced by tier 7-10 vehicle
presets. New, removed, renamed, or moved equipment therefore fails closed
instead of being silently omitted.
"""

import argparse
import base64
import json
import re
import urllib.request

from update_tankopedia import (
    EQUIPMENT_URL,
    PB_URL,
    as_int,
    as_str,
    decode_protobuf,
    f1,
    filter_to_business_tiers,
    i18n_en,
    parse_equipment_defs,
    parse_tanks,
)

BLITZKIT_REPO = "blitzkit/blitzkit"
SOURCE_FILES = {
    "characteristics": (
        "packages/website/src/core/blitzkit/tankCharacteristics.ts",
        "d9d04109829c1095c6c51edd50bd3adf29097b0f",
    ),
    "penetration": (
        "packages/core/src/blitzkit/resolvePenetrationCoefficient.ts",
        "56dcb256083b25a6902c73126faeb08065351d69",
    ),
    "armor": (
        "packages/website/src/components/Armor/components/StaticArmorSceneComponent.tsx",
        "37173d1972d84c210a5765be9af3baff7d255252",
    ),
}

FULLY_MODELED_CODES = {
    "GUN_RAMMER",
    "IMPROVED_VENTILATION",
    "CALIBRATED_SHELLS",
    "ENHANCED_GUN_LAYING_DRIVE",
    "VERTICAL_STABILIZER",
    "REFINED_GUN",
    "ENHANCED_ARMOR",
    "IMPROVED_ASSEMBLY",
    "IMPROVED_OPTICS",
    "CAMOUFLAGE_NET",
    "IMPROVED_CONTROL",
    "ENGINE_ACCELERATOR",
}

LOCKED_CODES = {
    "SUPERCHARGER",
    "IMPROVED_VERTICAL_STABILIZER",
    "IMPROVED_SUSPENSION",
    "IMPROVED_MODULES",
    "DEFENSE_SYSTEM",
    "ENHANCED_TRACKS",
    "TOOLBOX",
    "CONSUMABLE_DELIVERY_SYSTEM",
    "HIGH_END_CONSUMABLES",
}
GRID_GROUPS = ("FIREPOWER", "VITALITY", "SPECIALIZATION")


def fetch(url, binary=False):
    request = urllib.request.Request(url, headers={"User-Agent": "WotBTools-data-sync"})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read()
    return data if binary else data.decode("utf-8")


def fetch_reviewed_source(path, expected_blob_sha):
    """Fetch main only when the exact reviewed blob is still current."""
    url = f"https://api.github.com/repos/{BLITZKIT_REPO}/contents/{path}?ref=main"
    payload = json.loads(fetch(url))
    actual_sha = payload.get("sha")
    if actual_sha != expected_blob_sha:
        raise RuntimeError(
            "BLITZKIT_SOURCE_CHANGED: %s expected=%s actual=%s; review upstream and update the lock"
            % (path, expected_blob_sha, actual_sha)
        )
    content = payload.get("content")
    if not content:
        raise RuntimeError("BLITZKIT_SOURCE_MISSING_CONTENT: " + path)
    return base64.b64decode(content).decode("utf-8")


def coefficient(text, variable):
    match = re.search(r"\[" + re.escape(variable) + r",\s*(-?\d+(?:\.\d+)?)\]", text)
    if not match:
        raise RuntimeError("BLITZKIT_PATTERN_MISSING: coefficient for " + variable)
    return float(match.group(1))


def ternary_number(text, marker):
    match = re.search(re.escape(marker) + r"\s*\?\s*(-?\d+(?:\.\d+)?)\s*:\s*0", text)
    if not match:
        raise RuntimeError("BLITZKIT_PATTERN_MISSING: " + marker)
    return float(match.group(1))


def item_by_code(payload, code):
    for item in payload["items"]:
        if item.get("code") == code:
            return item
    raise RuntimeError("CATALOG_ITEM_MISSING: " + code)


def set_single_multiplier(payload, code, stat, value):
    item = item_by_code(payload, code)
    item["effects"] = [{"stat": stat, "operation": "MULTIPLY", "value": round(value, 6)}]


def parse_calibrated(text):
    values = re.findall(r"SHELL_TYPE_(APCR|HEAT|AP)\s*\n?\s*\?\s*(1\.\d+)", text)
    result = {kind: float(value) for kind, value in values}
    tail = re.search(r"SHELL_TYPE_HEAT[\s\S]*?\?\s*(1\.\d+)\s*\n?\s*:\s*(1\.\d+)\s*\n?\s*:\s*1", text)
    if not {"AP", "APCR", "HEAT"}.issubset(result) or not tail:
        raise RuntimeError("BLITZKIT_PATTERN_MISSING: calibrated shells")
    result["HE"] = float(tail.group(2))
    return result


def parse_class_values(block):
    result = {}
    for cls in ("HEAVY", "MEDIUM", "LIGHT"):
        match = re.search(r"TANK_CLASS_" + cls + r"\s*\n?\s*\?\s*(0\.\d+)", block)
        if not match:
            raise RuntimeError("BLITZKIT_PATTERN_MISSING: class " + cls)
        result[cls] = float(match.group(1))
    matches = re.findall(r":\s*(0\.\d+)\s*,", block)
    if not matches:
        raise RuntimeError("BLITZKIT_PATTERN_MISSING: tank destroyer class value")
    result["TANK_DESTROYER"] = float(matches[-1])
    return result


def parse_equipment_details(pb_bytes):
    details = {}
    root = decode_protobuf(pb_bytes)
    for raw_equipment in root.get(2, []):
        kv = decode_protobuf(raw_equipment)
        equipment_id = as_int(f1(kv, 1))
        if equipment_id is None:
            continue
        equipment = decode_protobuf(f1(kv, 2, b""))
        details[equipment_id] = {
            "name": i18n_en(f1(equipment, 1, b"")),
            "description": i18n_en(f1(equipment, 2, b"")),
        }
    return details


def grid_position(index):
    """Decode BlitzKit's row-major 3x3 equipment grid into group and slot."""
    if index < 0 or index >= 9:
        raise RuntimeError("BLITZKIT_PRESET_LAYOUT_UNSUPPORTED: slot=%d" % index)
    return GRID_GROUPS[index % 3], index // 3 + 1


def parse_equipment_placements(pb_bytes, used_presets):
    placements = {}
    root = decode_protobuf(pb_bytes)
    for raw_preset in root.get(1, []):
        kv = decode_protobuf(raw_preset)
        preset_name = as_str(f1(kv, 1, b""))
        if preset_name not in used_presets:
            continue
        preset = decode_protobuf(f1(kv, 2, b""))
        for index, raw_slot in enumerate(preset.get(1, [])):
            try:
                position = grid_position(index)
            except RuntimeError as error:
                raise RuntimeError("%s preset=%s" % (error, preset_name)) from error
            slot = decode_protobuf(raw_slot)
            for field, side in ((1, "LEFT"), (2, "RIGHT")):
                equipment_id = as_int(f1(slot, field))
                if equipment_id:
                    placements.setdefault(equipment_id, set()).add(position + (side,))
    return placements


def required_business_equipment_ids(vehicles, presets):
    preset_names = {v.get("_equipmentPreset") for v in vehicles.values() if v.get("_equipmentPreset")}
    missing_presets = sorted(name for name in preset_names if name not in presets)
    if missing_presets:
        raise RuntimeError("BLITZKIT_PRESET_MISSING: " + ", ".join(missing_presets))
    required_ids = set()
    for name in preset_names:
        required_ids.update(presets[name])
    return preset_names, required_ids


def validate_upstream_contract(payload, equipment_pb, tanks_pb):
    presets, equipment_names = parse_equipment_defs(equipment_pb)
    vehicles = filter_to_business_tiers(parse_tanks(tanks_pb))
    used_presets, required_ids = required_business_equipment_ids(vehicles, presets)
    placements = parse_equipment_placements(equipment_pb, used_presets)

    catalog_by_id = {item["id"]: item for item in payload["items"]}
    missing = sorted(required_ids - set(catalog_by_id))
    if missing:
        rendered = [f"{item_id}:{equipment_names.get(item_id, '?')}" for item_id in missing]
        raise RuntimeError("BLITZKIT_NEW_BUSINESS_EQUIPMENT: " + ", ".join(rendered))

    for item in payload["items"]:
        equipment_id = item["id"]
        upstream_name = equipment_names.get(equipment_id)
        if upstream_name is None:
            raise RuntimeError("BLITZKIT_EQUIPMENT_REMOVED: %s id=%s" % (item["code"], equipment_id))
        if upstream_name != item.get("nameEn"):
            raise RuntimeError(
                "BLITZKIT_EQUIPMENT_RENAMED: %s catalog=%r upstream=%r"
                % (item["code"], item.get("nameEn"), upstream_name)
            )
        if equipment_id in required_ids:
            local_grid = item.get("grid") or {}
            expected = (local_grid.get("group"), local_grid.get("slot"), local_grid.get("side"))
            actual = placements.get(equipment_id, set())
            if actual != {expected}:
                raise RuntimeError(
                    "BLITZKIT_EQUIPMENT_GRID_CHANGED: %s catalog=%s upstream=%s"
                    % (item["code"], expected, sorted(actual))
                )

    codes = {item["code"] for item in payload["items"]}
    modeled = FULLY_MODELED_CODES | LOCKED_CODES
    if codes != modeled:
        raise RuntimeError(
            "CATALOG_MODEL_COVERAGE_MISMATCH: missing_models=%s stale_models=%s"
            % (sorted(codes - modeled), sorted(modeled - codes))
        )


def sync_values(payload, characteristics, penetration, armor):
    set_single_multiplier(payload, "GUN_RAMMER", "reloadTime", 1 + coefficient(characteristics, "hasGunRammer"))

    vent = ternary_number(characteristics, "hasImprovedVentilation")
    item_by_code(payload, "IMPROVED_VENTILATION")["effects"][0]["value"] = round(vent * 100, 6)

    calibrated = parse_calibrated(penetration)
    calibrated_item = item_by_code(payload, "CALIBRATED_SHELLS")
    for effect in calibrated_item["effects"]:
        shell = effect["conditions"]["shellTypes"][0]
        effect["value"] = calibrated["HE" if shell in ("HE", "HEP", "HESH") else shell]

    set_single_multiplier(
        payload,
        "ENHANCED_GUN_LAYING_DRIVE",
        "aimTime",
        1 + coefficient(characteristics, "hasEnhancedGunLayingDrive"),
    )

    vertical = round(1 + coefficient(characteristics, "hasVerticalStabilizer"), 6)
    for effect in item_by_code(payload, "VERTICAL_STABILIZER")["effects"]:
        effect["value"] = vertical

    set_single_multiplier(payload, "REFINED_GUN", "baseDispersion", 1 + coefficient(characteristics, "hasRefinedGun"))
    set_single_multiplier(payload, "IMPROVED_ASSEMBLY", "hitPoints", 1 + coefficient(characteristics, "hasImprovedAssembly"))
    set_single_multiplier(payload, "IMPROVED_CONTROL", "hullTraverseSpeed", 1 + coefficient(characteristics, "hasImprovedControl"))
    set_single_multiplier(payload, "ENGINE_ACCELERATOR", "enginePower", 1 + coefficient(characteristics, "hasEngineAccelerator"))

    armor_match = re.search(r"hasEnhancedArmor\s*\?\s*(1\.\d+)\s*:\s*1", armor)
    if not armor_match:
        raise RuntimeError("BLITZKIT_PATTERN_MISSING: enhanced armor")
    item_by_code(payload, "ENHANCED_ARMOR")["effects"][0]["value"] = float(armor_match.group(1))

    optics_block = characteristics.split("const viewRangeCoefficient =", 1)[1].split("const fireChanceCoefficient", 1)[0]
    optics = parse_class_values(optics_block)
    for effect in item_by_code(payload, "IMPROVED_OPTICS")["effects"]:
        cls = effect["conditions"]["vehicleClasses"][0]
        effect["value"] = round(1 + optics[cls], 6)

    moving_block = characteristics.split("const camouflageCoefficientMoving =", 1)[1].split("const camouflageCoefficientStill =", 1)[0]
    moving_block = moving_block.split("hasCamouflageNet,", 1)[1]
    still_block = characteristics.split("const camouflageCoefficientStill =", 1)[1].split("const size =", 1)[0]
    still_block = still_block.split("hasCamouflageNet,", 1)[1]
    moving = parse_class_values(moving_block)
    still = parse_class_values(still_block)
    effects = []
    for cls in ("LIGHT", "MEDIUM", "HEAVY", "TANK_DESTROYER"):
        effects.append({
            "stat": "camouflageRatingBonus",
            "operation": "ADD_PERCENTAGE_POINTS",
            "value": round(moving[cls] * 100, 6),
            "conditions": {"vehicleClasses": [cls]},
        })
        extra = still[cls] - moving[cls]
        if extra > 0:
            effects.append({
                "stat": "camouflageRatingBonus",
                "operation": "ADD_PERCENTAGE_POINTS",
                "value": round(extra * 100, 6),
                "conditions": {"vehicleClasses": [cls], "stationarySecondsAtLeast": 3},
            })
    item_by_code(payload, "CAMOUFLAGE_NET")["effects"] = effects


def validate(payload):
    ids = [item["id"] for item in payload["items"]]
    codes = [item["code"] for item in payload["items"]]
    if len(ids) != len(set(ids)):
        raise RuntimeError("CATALOG_DUPLICATE_EQUIPMENT_ID")
    if len(codes) != len(set(codes)):
        raise RuntimeError("CATALOG_DUPLICATE_EQUIPMENT_CODE")
    for item in payload["items"]:
        if not item.get("effects"):
            raise RuntimeError("CATALOG_EMPTY_EFFECTS: " + item["code"])


def main():
    # Keep the historical CLI entry point safe by delegating to the snapshot-aware
    # updater, which enforces the game-version and locked-description contracts.
    from sync_equipment_snapshot import main as snapshot_main

    return snapshot_main()


if __name__ == "__main__":
    raise SystemExit(main())
