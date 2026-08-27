# -*- coding: utf-8 -*-
"""validate_locked_equipment_contract.py unit tests."""

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
    "DEFENSE_SYSTEM": "decreases the enemy's chances of dealing damage to your tank's modules and crew. %(engineevasionpercentagebonus) to the chance of engine damage. %(crewevasionpercentagebonus) to the chance of crew injury. %(ammoevasionpercentagebonus) to the chance of ammo rack explosion.",
    "ENHANCED_TRACKS": "makes the tracks more durable to withstand more damage. also, fully repairs the tracks automatically if they're destroyed.",
    "TOOLBOX": "%(repairspeedfactor) to module repair speed.",
    "CONSUMABLE_DELIVERY_SYSTEM": "allows consumables and abilities in modes to be used more often. %(equipmentreloadboost) to cooldown speed of consumables and abilities.",
    "HIGH_END_CONSUMABLES": "allows bonuses from consumables and bonuses from abilities in modes to last longer. %(equipmentdurationfactor) to the duration of consumables and abilities.",
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

    def test_any_template_change_fails_closed(self):
        payload = self.payload()
        details = self.details(payload)
        item = next(item for item in payload["items"] if item["code"] == "SUPERCHARGER")
        details[item["id"]]["description"] += " Additional effect."
        with self.assertRaisesRegex(RuntimeError, "BLITZKIT_LOCKED_DESCRIPTION_CHANGED"):
            validator.validate_locked_contract(payload, details)

    def test_game_version_must_be_exact_reviewed_build(self):
        self.assertTrue(
            validator.validate_reviewed_game_version("11.19.0.834_7320229")
        )
        with self.assertRaisesRegex(RuntimeError, "BLITZKIT_LOCKED_REVIEW_REQUIRED"):
            validator.validate_reviewed_game_version("11.19.0.835_9999999")


if __name__ == "__main__":
    unittest.main()
