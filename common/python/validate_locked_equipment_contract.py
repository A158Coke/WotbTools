#!/usr/bin/env python3
"""Fail-closed fingerprint checks for equipment whose effects are not fully modeled."""

import hashlib

from update_equipment import item_by_code, parse_equipment_details

# Reviewed normalized English descriptions for locked equipment.
# Any upstream wording/value/semantic change must be explicitly reviewed and this lock updated.
LOCKED_DESCRIPTION_SHA256 = {
    "SUPERCHARGER": "f8018df6dd484975dcd8bf05eecda9fff30a212770649943a58c0f27ea6a7c76",
    "IMPROVED_VERTICAL_STABILIZER": "8d6644034eade961804892cb67b23177f7a020e44e95e0eb90ecd2f68b9b810c",
    "IMPROVED_SUSPENSION": "990b7596cdccd60d39fba81cd3f416fb31298565c3700b06c3cd3f7f3fa48b60",
    "IMPROVED_MODULES": "586a173bed0b5dd2a0fc74d8224e39947c90a9d04f58dec19585b3e60a43b933",
    "DEFENSE_SYSTEM": "bcfd48169de5bbe67c78244d122c4a15fd17358197f904b0e3728c8a036a1d18",
    "ENHANCED_TRACKS": "0aa99b68b0bd2a9821e37482d5128da157b0949eeb8a69089a06ab7a686ba8f9",
    "TOOLBOX": "7a5f59c269a2105b76363f268bf8d51354a59733bbdf24f1852ea4ceafac916e",
    "CONSUMABLE_DELIVERY_SYSTEM": "ad53eeb8e6638a25044f198564dce9844f2567fda79c8c3bd492372469e32ebc",
    "HIGH_END_CONSUMABLES": "8ec81e08de6bc56f40a9020f3cd4223b68e219935aae676e91fc47792b5fde27",
}


def normalize_description(description):
    return " ".join((description or "").lower().split())


def description_sha256(description):
    normalized = normalize_description(description)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def validate_locked_contract(payload, details):
    for code, expected_hash in LOCKED_DESCRIPTION_SHA256.items():
        item = item_by_code(payload, code)
        detail = details.get(item["id"])
        if not detail:
            raise RuntimeError("BLITZKIT_EQUIPMENT_DESCRIPTION_MISSING: " + code)
        description = detail.get("description") or ""
        actual_hash = description_sha256(description)
        if actual_hash != expected_hash:
            raise RuntimeError(
                "BLITZKIT_LOCKED_DESCRIPTION_CHANGED: %s expected=%s actual=%s"
                % (code, expected_hash, actual_hash)
            )
    return True


def validate_locked_contract_from_pb(payload, equipment_pb):
    return validate_locked_contract(payload, parse_equipment_details(equipment_pb))
