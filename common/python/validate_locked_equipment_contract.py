#!/usr/bin/env python3
"""Strict fail-closed checks for equipment whose effects are not fully modeled in code."""

import re

from update_equipment import item_by_code, parse_equipment_details

# Exact percentage magnitudes expected in the live English description.
# Using a sorted list (not a set) also detects duplicate/new percentage-bearing effects.
LOCKED_PERCENTAGES = {
    "SUPERCHARGER": [35.0, 60.0],
    "IMPROVED_VERTICAL_STABILIZER": [3.0, 4.0],
    "IMPROVED_SUSPENSION": [15.0, 20.0, 30.0],
    "IMPROVED_MODULES": [20.0, 40.0],
    "DEFENSE_SYSTEM": [10.0, 15.0, 25.0],
    "ENHANCED_TRACKS": [],
    "TOOLBOX": [20.0],
    "CONSUMABLE_DELIVERY_SYSTEM": [12.0],
    "HIGH_END_CONSUMABLES": [33.0],
}

# Semantic anchors: a description can only pass when it still talks about the
# reviewed mechanics. This intentionally errs on the side of stopping updates.
LOCKED_KEYWORDS = {
    "SUPERCHARGER": ("shell", "velocity", "penetration"),
    "IMPROVED_VERTICAL_STABILIZER": ("gun",),
    "IMPROVED_SUSPENSION": ("terrain",),
    "IMPROVED_MODULES": ("module", "ramming"),
    "DEFENSE_SYSTEM": ("engine", "crew", "ammo"),
    "ENHANCED_TRACKS": ("track", "repair"),
    "TOOLBOX": ("repair",),
    "CONSUMABLE_DELIVERY_SYSTEM": ("consumable",),
    "HIGH_END_CONSUMABLES": ("consumable",),
}

# Explicit reversals that would otherwise preserve all numeric markers.
FORBIDDEN_PHRASES = {
    "SUPERCHARGER": (
        "decrease shell velocity",
        "reduce shell velocity",
        "increase penetration loss",
    ),
    "IMPROVED_MODULES": ("increase ramming damage",),
    "DEFENSE_SYSTEM": (
        "increase engine damage chance",
        "increase crew injury chance",
        "increase ammo rack explosion chance",
    ),
    "TOOLBOX": ("decrease repair speed", "reduce repair speed"),
}


def extract_percentage_magnitudes(description):
    values = re.findall(r"[+-]?(\d+(?:\.\d+)?)\s*%", description or "")
    return sorted(float(value) for value in values)


def validate_locked_contract(payload, details):
    for code, expected_percentages in LOCKED_PERCENTAGES.items():
        item = item_by_code(payload, code)
        detail = details.get(item["id"])
        if not detail:
            raise RuntimeError("BLITZKIT_EQUIPMENT_DESCRIPTION_MISSING: " + code)
        description = detail.get("description") or ""
        actual_percentages = extract_percentage_magnitudes(description)
        if actual_percentages != expected_percentages:
            raise RuntimeError(
                "BLITZKIT_LOCKED_EFFECT_CHANGED: %s expected_percentages=%s upstream_percentages=%s"
                % (code, expected_percentages, actual_percentages)
            )

        lowered = " ".join(description.lower().split())
        missing_keywords = [
            keyword for keyword in LOCKED_KEYWORDS.get(code, ()) if keyword not in lowered
        ]
        if missing_keywords:
            raise RuntimeError(
                "BLITZKIT_LOCKED_EFFECT_CHANGED: %s missing_keywords=%s"
                % (code, missing_keywords)
            )
        forbidden = [
            phrase for phrase in FORBIDDEN_PHRASES.get(code, ()) if phrase in lowered
        ]
        if forbidden:
            raise RuntimeError(
                "BLITZKIT_LOCKED_EFFECT_CHANGED: %s forbidden_phrases=%s"
                % (code, forbidden)
            )
    return True


def validate_locked_contract_from_pb(payload, equipment_pb):
    return validate_locked_contract(payload, parse_equipment_details(equipment_pb))
