#!/usr/bin/env python3
"""Strict fail-closed checks for equipment whose effects are not fully modeled in code."""

import re

from update_equipment import item_by_code, parse_equipment_details

INCREASE_WORDS = r"(?:increase(?:s|d)?|improve(?:s|d)?|boost(?:s|ed)?|raise(?:s|d)?)"
DECREASE_WORDS = r"(?:decrease(?:s|d)?|reduce(?:s|d)?|lower(?:s|ed)?|cut(?:s)?)"

# Each locked effect is matched as one reviewed semantic clause: direction + subject + value.
# A wording/meaning/value change therefore fails closed instead of being inferred from loose markers.
LOCKED_EFFECTS = {
    "SUPERCHARGER": (
        ("increase", 35.0, ("shell", "velocity")),
        ("decrease", 60.0, ("penetration", "loss")),
    ),
    "IMPROVED_VERTICAL_STABILIZER": (
        ("increase", 4.0, ("gun", "elevation")),
        ("increase", 3.0, ("gun", "depression")),
    ),
    "IMPROVED_SUSPENSION": (
        ("increase", 20.0, ("terrain", "hard")),
        ("increase", 15.0, ("terrain", "medium")),
        ("increase", 30.0, ("terrain", "soft")),
    ),
    "IMPROVED_MODULES": (
        ("increase", 20.0, ("module", "durability")),
        ("decrease", 40.0, ("ramming", "damage")),
    ),
    "DEFENSE_SYSTEM": (
        ("decrease", 10.0, ("engine", "damage")),
        ("decrease", 15.0, ("crew", "injury")),
        ("decrease", 25.0, ("ammo", "explosion")),
    ),
    "TOOLBOX": (("increase", 20.0, ("repair", "speed")),),
    "CONSUMABLE_DELIVERY_SYSTEM": (("decrease", 12.0, ("consumable", "cooldown")),),
    "HIGH_END_CONSUMABLES": (("increase", 33.0, ("consumable", "duration")),),
}

# Non-percentage semantic contract. Any rewording that removes these reviewed mechanics stops the sync.
LOCKED_TEXT_ONLY = {
    "ENHANCED_TRACKS": ("track", "repair", "durability"),
}


def normalize(description):
    return " ".join((description or "").lower().split())


def percentage_values(description):
    return sorted(float(value) for value in re.findall(r"[+-]?(\d+(?:\.\d+)?)\s*%", description or ""))


def clause_matches(description, direction, value, keywords):
    """Match one semantic effect inside a sentence-like clause, not across the full description."""
    direction_pattern = INCREASE_WORDS if direction == "increase" else DECREASE_WORDS
    value_pattern = r"(?:[+-]?%s(?:\.0+)?)\s*%%" % re.escape(str(value).rstrip("0").rstrip("."))
    clauses = [normalize(part) for part in re.split(r"[.;\n]+", description or "") if part.strip()]
    for clause in clauses:
        if not re.search(direction_pattern, clause):
            continue
        if not re.search(value_pattern, clause):
            continue
        if all(keyword in clause for keyword in keywords):
            return True
    return False


def validate_locked_contract(payload, details):
    for code, effects in LOCKED_EFFECTS.items():
        item = item_by_code(payload, code)
        detail = details.get(item["id"])
        if not detail:
            raise RuntimeError("BLITZKIT_EQUIPMENT_DESCRIPTION_MISSING: " + code)
        description = detail.get("description") or ""

        expected_percentages = sorted(value for _, value, _ in effects)
        actual_percentages = percentage_values(description)
        if actual_percentages != expected_percentages:
            raise RuntimeError(
                "BLITZKIT_LOCKED_EFFECT_CHANGED: %s expected_percentages=%s upstream_percentages=%s"
                % (code, expected_percentages, actual_percentages)
            )

        missing_effects = [
            "%s %.6g%% %s" % (direction, value, "/".join(keywords))
            for direction, value, keywords in effects
            if not clause_matches(description, direction, value, keywords)
        ]
        if missing_effects:
            raise RuntimeError(
                "BLITZKIT_LOCKED_EFFECT_CHANGED: %s missing_semantic_effects=%s"
                % (code, missing_effects)
            )

    for code, keywords in LOCKED_TEXT_ONLY.items():
        item = item_by_code(payload, code)
        detail = details.get(item["id"])
        if not detail:
            raise RuntimeError("BLITZKIT_EQUIPMENT_DESCRIPTION_MISSING: " + code)
        lowered = normalize(detail.get("description"))
        missing = [keyword for keyword in keywords if keyword not in lowered]
        if missing:
            raise RuntimeError(
                "BLITZKIT_LOCKED_EFFECT_CHANGED: %s missing_keywords=%s" % (code, missing)
            )
    return True


def validate_locked_contract_from_pb(payload, equipment_pb):
    return validate_locked_contract(payload, parse_equipment_details(equipment_pb))
