# -*- coding: utf-8 -*-
"""validate_locked_equipment_contract.py unit tests."""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import validate_locked_equipment_contract as validator


class LockedEquipmentContractTest(unittest.TestCase):
    def payload(self):
        return {
            "items": [
                {"id": item_id, "code": code}
                for item_id, code in enumerate(validator.LOCKED_PERCENTAGES, start=1000)
            ]
        }

    def details(self, payload):
        descriptions = {
            "SUPERCHARGER": "Increases shell velocity by 35%. Reduces penetration loss by 60%.",
            "IMPROVED_VERTICAL_STABILIZER": "Improves gun elevation by 4% and depression by 3%.",
            "IMPROVED_SUSPENSION": "Improves terrain performance by 20%, 15%, and 30%.",
            "IMPROVED_MODULES": "Increases module durability by 20%. Reduces ramming damage by 40%.",
            "DEFENSE_SYSTEM": "Reduces engine damage by 10%, crew injury by 15%, and ammo explosion by 25%.",
            "ENHANCED_TRACKS": "Track repair restores durability.",
            "TOOLBOX": "Increases repair speed by 20%.",
            "CONSUMABLE_DELIVERY_SYSTEM": "Reduces consumable cooldown by 12%.",
            "HIGH_END_CONSUMABLES": "Increases consumable duration by 33%.",
        }
        by_code = {item["code"]: item for item in payload["items"]}
        return {
            by_code[code]["id"]: {"description": description}
            for code, description in descriptions.items()
        }

    def test_reviewed_contract_passes(self):
        payload = self.payload()
        self.assertTrue(validator.validate_locked_contract(payload, self.details(payload)))

    def test_new_percentage_effect_fails_closed(self):
        payload = self.payload()
        details = self.details(payload)
        item = next(item for item in payload["items"] if item["code"] == "SUPERCHARGER")
        details[item["id"]]["description"] += " Increases accuracy by 10%."
        with self.assertRaisesRegex(RuntimeError, "BLITZKIT_LOCKED_EFFECT_CHANGED"):
            validator.validate_locked_contract(payload, details)

    def test_semantic_reversal_fails_closed(self):
        payload = self.payload()
        details = self.details(payload)
        item = next(item for item in payload["items"] if item["code"] == "SUPERCHARGER")
        details[item["id"]]["description"] = (
            "Decrease shell velocity by 35%. Reduces penetration loss by 60%."
        )
        with self.assertRaisesRegex(RuntimeError, "forbidden_phrases"):
            validator.validate_locked_contract(payload, details)

    def test_missing_semantic_anchor_fails_closed(self):
        payload = self.payload()
        details = self.details(payload)
        item = next(item for item in payload["items"] if item["code"] == "ENHANCED_TRACKS")
        details[item["id"]]["description"] = "Provides a special bonus."
        with self.assertRaisesRegex(RuntimeError, "missing_keywords"):
            validator.validate_locked_contract(payload, details)


if __name__ == "__main__":
    unittest.main()
