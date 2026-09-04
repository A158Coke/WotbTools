# -*- coding: utf-8 -*-
"""validate_locked_equipment_contract.py unit tests."""

import hashlib
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import validate_locked_equipment_contract as validator


REVIEWED_DESCRIPTIONS = {
    "SUPERCHARGER": "increases the chance of hitting and penetrating from a distance. %(projectilespeedfactor) to shell velocity. %(piercingpenaltyfactor500m) to penetration decrease with distance.",
    "IMPROVED_VERTICAL_STABILIZER": "improves aiming ability. +%(upperpitchlimitincrease)° to upper gun turn limit. +%(lowerpitchlimitincrease)° to lower gun turn limit.",
    "IMPROVED_SUSPENSION": "enhances terrain crossing capacity on various surfaces. %(firmgroundpassabilityincrease) improvement to crossing capacity on roads. %(mediumgroundpassabilityincrease) improvement to crossing capacity on ground. %(softgroundpassabilityincrease) improvement to crossing capacity on water.",
    "IMPROVED_MODULES": "increases the durability of modules and reduces damage from ramming. %(maxhealthpercentagebonus) to track durability. %(rammingabsorptionpercent) damage when rammed.",
    "IMPROVED_MODULES_PLUS": "increases the durability of modules and reduces damage from ramming. %(maxhealthpercentagebonus) to track durability. %(rammingabsorptionpercent) damage when rammed. reduces damage by 10% from high-explosive shells with a caliber larger than 130 mm.",
    "DEFENSE_SYSTEM": "decreases the enemy's chances of dealing damage to your tank's modules and crew. %(engineevasionpercentagebonus) to the chance of engine damage. %(crewevasionpercentagebonus) to the chance of crew injury. %(ammoevasionpercentagebonus) to the chance of ammo rack explosion.",
    "ENHANCED_TRACKS": "makes the tracks more durable to withstand more damage. also, fully repairs the tracks automatically if they're destroyed.",
    "TOOLBOX": "%(repairspeedfactor) to module repair speed.",
    "CONSUMABLE_DELIVERY_SYSTEM": "allows consumables and abilities in modes to be used more often. %(equipmentreloadboost) to cooldown speed of consumables and abilities.",
    "HIGH_END_CONSUMABLES": "allows bonuses from consumables and bonuses from abilities in modes to last longer. %(equipmentdurationfactor) to the duration of consumables and abilities.",
}


def encode_varint(value):
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def field_varint(field, value):
    return encode_varint((field << 3) | 0) + encode_varint(value)


def field_bytes(field, value):
    value = bytes(value)
    return encode_varint((field << 3) | 2) + encode_varint(len(value)) + value


def equipment_pb(item_id, definition):
    entry = field_varint(1, item_id) + field_bytes(2, definition)
    return field_bytes(2, entry)


class LockedEquipmentContractTest(unittest.TestCase):
    def payload(self):
        return {
            "items": [
                {"id": item_id, "code": code}
                for item_id, code in enumerate(validator.LOCKED_DESCRIPTION_SHA256, start=1000)
            ]
        }

    def details(self, payload):
        by_code = {item["code"]: item for item in payload["items"]}
        return {
            by_code[code]["id"]: {"description": description}
            for code, description in REVIEWED_DESCRIPTIONS.items()
        }

    def test_reviewed_live_fingerprints_pass(self):
        payload = self.payload()
        self.assertTrue(validator.validate_locked_contract(payload, self.details(payload)))

    def test_whitespace_and_case_are_normalized(self):
        original = REVIEWED_DESCRIPTIONS["SUPERCHARGER"]
        description = "  " + original.upper().replace(" ", "   ") + "  "
        self.assertEqual(
            validator.description_sha256(description),
            validator.LOCKED_DESCRIPTION_SHA256["SUPERCHARGER"],
        )

    def test_locked_template_change_fails_closed(self):
        payload = self.payload()
        details = self.details(payload)
        item = next(item for item in payload["items"] if item["code"] == "SUPERCHARGER")
        details[item["id"]]["description"] += " Additional effect."
        with self.assertRaisesRegex(RuntimeError, "BLITZKIT_LOCKED_DESCRIPTION_CHANGED"):
            validator.validate_locked_contract(payload, details)

    def test_complete_locked_definition_change_fails_even_when_description_could_stay_same(self):
        code = "SUPERCHARGER"
        item_id = 1000
        payload = {"items": [{"id": item_id, "code": code}]}
        reviewed = b"definition-with-hidden-numeric-fields"
        changed = reviewed + b"-changed"
        original_definitions = validator.LOCKED_DEFINITION_SHA256
        original_descriptions = validator.LOCKED_DESCRIPTION_SHA256
        try:
            validator.LOCKED_DEFINITION_SHA256 = {code: hashlib.sha256(reviewed).hexdigest()}
            validator.LOCKED_DESCRIPTION_SHA256 = {code: "unused-in-this-test"}
            self.assertTrue(
                validator.validate_locked_definition_contract(payload, equipment_pb(item_id, reviewed))
            )
            with self.assertRaisesRegex(RuntimeError, "BLITZKIT_LOCKED_DEFINITION_CHANGED"):
                validator.validate_locked_definition_contract(payload, equipment_pb(item_id, changed))
        finally:
            validator.LOCKED_DEFINITION_SHA256 = original_definitions
            validator.LOCKED_DESCRIPTION_SHA256 = original_descriptions

    def test_unrelated_upstream_changes_do_not_require_global_version_or_file_lock(self):
        payload = self.payload()
        details = self.details(payload)
        self.assertTrue(validator.validate_locked_contract(payload, details))
        self.assertFalse(hasattr(validator, "REVIEWED_GAME_VERSION"))
        self.assertFalse(hasattr(validator, "REVIEWED_EQUIPMENT_SHA256"))


if __name__ == "__main__":
    unittest.main()
