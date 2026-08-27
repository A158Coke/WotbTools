#!/usr/bin/env python3
"""Sync the equipment catalog from current BlitzKit sources.

BlitzKit's equipment.pb is authoritative for equipment IDs/names/presets while
its public calculation code is authoritative for the numerical effects used by
Tankopedia. This updater intentionally fails closed if an expected source
pattern disappears instead of guessing a value.
"""

import argparse
import json
import os
import re
import urllib.request

from update_tankopedia import EQUIPMENT_URL, parse_equipment_defs

TANK_CHARACTERISTICS_URL = (
    "https://raw.githubusercontent.com/blitzkit/blitzkit/main/"
    "packages/website/src/core/blitzkit/tankCharacteristics.ts"
)
PENETRATION_URL = (
    "https://raw.githubusercontent.com/blitzkit/blitzkit/main/"
    "packages/core/src/blitzkit/resolvePenetrationCoefficient.ts"
)
ARMOR_URL = (
    "https://raw.githubusercontent.com/blitzkit/blitzkit/main/"
    "packages/website/src/components/Armor/components/StaticArmorSceneComponent.tsx"
)


def fetch(url, binary=False):
    with urllib.request.urlopen(url, timeout=30) as response:
        data = response.read()
    return data if binary else data.decode("utf-8")


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


def sync_ids(payload, equipment_names):
    ids_by_name = {}
    for equipment_id, name in equipment_names.items():
        if name:
            ids_by_name.setdefault(name, []).append(equipment_id)
    for item in payload["items"]:
        name = item.get("nameEn")
        matches = ids_by_name.get(name, [])
        if len(matches) != 1:
            raise RuntimeError("BLITZKIT_ID_MATCH_FAILED: %s -> %s" % (name, matches))
        item["id"] = matches[0]


def parse_calibrated(text):
    values = re.findall(r"SHELL_TYPE_(APCR|HEAT|AP)\s*\n?\s*\?\s*(1\.\d+)", text)
    result = {kind: float(value) for kind, value in values}
    # Final fallback branch is HE/HEP/HESH.
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
    # The final else in these BlitzKit ternaries is Tank Destroyer.
    matches = re.findall(r":\s*(0\.\d+)\s*,", block)
    if not matches:
        raise RuntimeError("BLITZKIT_PATTERN_MISSING: tank destroyer class value")
    result["TANK_DESTROYER"] = float(matches[-1])
    return result


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
    item_by_code(payload, "SUPERCHARGER")["effects"][0]["value"] = round(
        1 + coefficient(characteristics, "hasSupercharger"), 6
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
    optics_item = item_by_code(payload, "IMPROVED_OPTICS")
    for effect in optics_item["effects"]:
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
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", default="common/wotb-item-catalog-json/equipment.json")
    args = parser.parse_args()

    with open(args.catalog, encoding="utf-8") as f:
        payload = json.load(f)

    _, equipment_names = parse_equipment_defs(fetch(EQUIPMENT_URL, binary=True))
    sync_ids(payload, equipment_names)
    sync_values(
        payload,
        fetch(TANK_CHARACTERISTICS_URL),
        fetch(PENETRATION_URL),
        fetch(ARMOR_URL),
    )
    validate(payload)

    with open(args.catalog, "w", encoding="utf-8", newline="\n") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main()
