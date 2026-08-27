# -*- coding: utf-8 -*-
"""validate_locked_equipment_contract.py unit tests."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import validate_locked_equipment_contract as validator


REVIEWED_DESCRIPTIONS = {
    "SUPERCHARGER": "Increases shell velocity by 35%. Reduces penetration loss by 60%.",
    "IMPROVED_VERTICAL_STABILIZER": "Increases gun elevation by 4%. Increases gun depression by 3%.",
    "IMPROVED_SUSPENSION": "Improves terrain performance on hard ground by 20%. Improves terrain performance on medium ground by 15%. Improves terrain performance on soft ground by 30%.",
    "IMPROVED_MODULES": "Increases module durability by 20%. Reduces ramming damage by 40%.",
    "DEFENSE_SYSTEM": "Reduces engine damage by 10%. Reduces crew injury by 15%. Reduces ammo explosion chance by 25%.",
    "ENHANCED_TRACKS": "Track repair restores full durability.",
    "TOOLBOX": "Increases repair speed by 20%.",
    "CONSUMABLE_DELIVERY_SYSTEM": "Reduces consumable cooldown by 12%.",
    "HIGH_END_CONSUMABLES": "Increases consumable duration by 33%.",
}


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

    def test_reviewed_fingerprints_pass(self):
        payload = self.payload()
        self.assertTrue(validator.validate_locked_contract(payload, self.details(payload)))

    def test_whitespace_and_case_are_normalized(self):
        description = "  INCREASES   SHELL VELOCITY BY 35%.   Reduces penetration loss by 60%. "
        self.assertEqual(
            validator.description_sha256(description),
            validator.LOCKED_DESCRIPTION_SHA256["SUPERCHARGER"],
        )

    def test_any_semantic_change_fails_closed(self):
        payload = self.payload()
        details = self.details(payload)
        item = next(item for item in payload["items"] if item["code"] == "SUPERCHARGER")
        details[item["id"]]["description"] = (
            "Does not increase shell velocity by 35%. Reduces penetration loss by 60%."
        )
        with self.assertRaisesRegex(RuntimeError, "BLITZKIT_LOCKED_DESCRIPTION_CHANGED"):
            validator.validate_locked_contract(payload, details)

    def test_sign_change_fails_closed(self):
        payload = self.payload()
        details = self.details(payload)
        item = next(item for item in payload["items"] if item["code"] == "SUPERCHARGER")
        details[item["id"]]["description"] = (
            "Increases shell velocity by -35%. Reduces penetration loss by 60%."
        )
        with self.assertRaisesRegex(RuntimeError, "BLITZKIT_LOCKED_DESCRIPTION_CHANGED"):
            validator.validate_locked_contract(payload, details)

    def test_new_effect_fails_closed(self):
        payload = self.payload()
        details = self.details(payload)
        item = next(item for item in payload["items"] if item["code"] == "SUPERCHARGER")
        details[item["id"]]["description"] += " Increases accuracy by 10%."
        with self.assertRaisesRegex(RuntimeError, "BLITZKIT_LOCKED_DESCRIPTION_CHANGED"):
            validator.validate_locked_contract(payload, details)


if __name__ == "__main__":
    unittest.main()
