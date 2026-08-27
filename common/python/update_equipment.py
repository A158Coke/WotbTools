#!/usr/bin/env python3
"""Safely sync the WotB equipment catalog from BlitzKit.

The updater separates two equipment classes:

* FULLY_MODELED_CODES: effects are derived from current BlitzKit calculation
  sources and may update automatically when the parser still understands them.
* LOCKED_CODES: WotBTools cannot derive every effect. Those items keep local
  reviewed effects and are guarded by item-scoped description fingerprints.

A new WoTB game version, changed protobuf snapshot, renamed known equipment, or
preset-layout change is not itself an error. The sync fails closed only when new
upstream data cannot be represented safely: for example, a newly referenced
equipment ID has no local model, a known item disappears, a locked item changes,
or a calculation source no longer matches the supported parser contract.
"""

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
    "characteristics": "packages/website/src/core/blitzkit/tankCharacteristics.ts",
    "penetration": "packages/core/src/blitzkit/resolvePenetrationCoefficient.ts",
    "armor": "packages/website/src/components/Armor/components/StaticArmorSceneComponent.tsx",
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


def fetch(url, binary=False):
    request = urllib.request.Request(url, headers={"User-Agent": "WotBTools-data-sync"})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read()
    return data if binary else data.decode("utf-8")


def fetch_source(path):
    """Fetch the current BlitzKit source file from main.

    Source blob changes are expected over time. Safety comes from strict parsers:
    if a supported calculation no longer has the expected shape, the sync raises
    BLITZKIT_PATTERN_MISSING instead of guessing.
    """
    url = f"https://api.github.com/repos/{BLITZKIT_REPO}/contents/{path}?ref=main"
    payload = json.loads(fetch(url))
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


def required_business_equipment_ids(vehicles, presets):
    preset_names = {v.get("_equipmentPreset") for v in vehicles.values() if v.get("_equipmentPreset")}
    missing_presets = sorted(name for name in preset_names if name not in presets)
    if missing_presets:
        raise RuntimeError("BLITZKIT_PRESET_MISSING: " + ", ".join(missing_presets))
    required_ids = set()
    for name in preset_names:
        required_ids.update(presets[name])
    return preset_names, required_ids


def sync_upstream_metadata(payload, equipment_pb, tanks_pb):
    """Import supported structural changes and reject unsupported new models."""
    presets, equipment_names = parse_equipment_defs(equipment_pb)
    vehicles = filter_to_business_tiers(parse_tanks(tanks_pb))
    _, required_ids = required_business_equipment_ids(vehicles, presets)

    catalog_by_id = {item["id"]: item for item in payload["items"]}
    missing = sorted(required_ids - set(catalog_by_id))
    if missing:
        rendered = [f"{item_id}:{equipment_names.get(item_id, '?')}" for item_id in missing]
        raise RuntimeError(
            "BLITZKIT_NEW_BUSINESS_EQUIPMENT_UNMODELED: " + ", ".join(rendered)
            + "; add a complete local effect model before accepting this equipment"
        )

    for item in payload["items"]:
        equipment_id = item["id"]
        upstream_name = equipment_names.get(equipment_id)
        if upstream_name is None:
            raise RuntimeError("BLITZKIT_EQUIPMENT_REMOVED: %s id=%s" % (item["code"], equipment_id))
        if upstream_name and upstream_name != item.get("nameEn"):
            item["nameEn"] = upstream_name

    codes = {item["code"] for item in payload["items"]}
    modeled = FULLY_MODELED_CODES | LOCKED_CODES
    if codes != modeled:
        raise RuntimeError(
            "CATALOG_MODEL_COVERAGE_MISMATCH: missing_models=%s stale_models=%s"
            % (sorted(codes - modeled), sorted(modeled - codes))
        )
    return True


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
    from sync_equipment_snapshot import main as snapshot_main

    return snapshot_main()


if __name__ == "__main__":
    raise SystemExit(main())
