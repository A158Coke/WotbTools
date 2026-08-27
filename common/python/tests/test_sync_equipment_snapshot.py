# -*- coding: utf-8 -*-
"""sync_equipment_snapshot.py and equipment structural contract tests."""

import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sync_equipment_snapshot as sync


class EquipmentSnapshotContractTest(unittest.TestCase):
    def test_structural_contract_does_not_assume_universal_grid(self):
        payload = {
            "items": [
                {"id": 100, "code": "A", "nameEn": "Alpha"},
                {"id": 101, "code": "B", "nameEn": "Beta"},
            ]
        }
        vehicles = {"1": {"_equipmentPreset": "special"}}
        with (
            patch.object(sync.ue, "parse_equipment_defs", return_value=({"special": {100, 101}}, {100: "Alpha", 101: "Beta"})),
            patch.object(sync.ue, "parse_tanks", return_value=vehicles),
            patch.object(sync.ue, "filter_to_business_tiers", return_value=vehicles),
            patch.object(sync.ue, "FULLY_MODELED_CODES", {"A"}),
            patch.object(sync.ue, "LOCKED_CODES", {"B"}),
        ):
            self.assertTrue(sync.ue.validate_upstream_contract(payload, b"equipment", b"tanks"))

    def test_unknown_business_equipment_fails_closed(self):
        payload = {"items": [{"id": 100, "code": "A", "nameEn": "Alpha"}]}
        vehicles = {"1": {"_equipmentPreset": "special"}}
        with (
            patch.object(sync.ue, "parse_equipment_defs", return_value=({"special": {100, 999}}, {100: "Alpha", 999: "New"})),
            patch.object(sync.ue, "parse_tanks", return_value=vehicles),
            patch.object(sync.ue, "filter_to_business_tiers", return_value=vehicles),
            patch.object(sync.ue, "FULLY_MODELED_CODES", {"A"}),
            patch.object(sync.ue, "LOCKED_CODES", set()),
        ):
            with self.assertRaisesRegex(RuntimeError, "BLITZKIT_NEW_BUSINESS_EQUIPMENT"):
                sync.ue.validate_upstream_contract(payload, b"equipment", b"tanks")

    def test_camouflage_effects_have_stable_catalog_order(self):
        effects = []
        for vehicle_class in ("LIGHT", "MEDIUM", "HEAVY", "TANK_DESTROYER"):
            effects.append({
                "stat": "camouflageRatingBonus",
                "conditions": {"vehicleClasses": [vehicle_class]},
            })
            effects.append({
                "stat": "camouflageRatingBonus",
                "conditions": {
                    "vehicleClasses": [vehicle_class],
                    "stationarySecondsAtLeast": 3,
                },
            })
        payload = {"items": [{"code": "CAMOUFLAGE_NET", "effects": effects}]}
        sync.stabilize_generated_effect_order(payload)
        ordered = payload["items"][0]["effects"]
        self.assertEqual(
            ["LIGHT", "MEDIUM", "HEAVY", "TANK_DESTROYER"],
            [effect["conditions"]["vehicleClasses"][0] for effect in ordered[:4]],
        )
        self.assertTrue(all("stationarySecondsAtLeast" not in e["conditions"] for e in ordered[:4]))
        self.assertTrue(all("stationarySecondsAtLeast" in e["conditions"] for e in ordered[4:]))


if __name__ == "__main__":
    unittest.main()
