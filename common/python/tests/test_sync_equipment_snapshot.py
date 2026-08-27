# -*- coding: utf-8 -*-
"""sync_equipment_snapshot.py and equipment structural contract tests."""

import os
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import sync_equipment_snapshot as sync


class EquipmentSnapshotContractTest(unittest.TestCase):
    def test_special_preset_does_not_redefine_canonical_grid(self):
        payload = {
            "items": [
                {"id": 100, "code": "A", "nameEn": "Alpha", "grid": {"group": "FIREPOWER", "slot": 1, "side": "LEFT"}},
                {"id": 101, "code": "B", "nameEn": "Beta", "grid": {"group": "VITALITY", "slot": 1, "side": "LEFT"}},
            ]
        }
        vehicles = {"1": {"_equipmentPreset": "special"}}
        canonical = {
            100: {"group": "FIREPOWER", "slot": 1, "side": "LEFT"},
            101: {"group": "VITALITY", "slot": 1, "side": "LEFT"},
        }
        with (
            patch.object(sync.ue, "parse_equipment_defs", return_value=({"special": {100, 101}}, {100: "Alpha", 101: "Beta"})),
            patch.object(sync.ue, "parse_tanks", return_value=vehicles),
            patch.object(sync.ue, "filter_to_business_tiers", return_value=vehicles),
            patch.object(sync.ue, "parse_canonical_grid", return_value=canonical),
            patch.object(sync.ue, "FULLY_MODELED_CODES", {"A"}),
            patch.object(sync.ue, "LOCKED_CODES", {"B"}),
        ):
            self.assertTrue(sync.ue.sync_upstream_metadata(payload, b"equipment", b"tanks"))
        self.assertEqual(canonical[100], payload["items"][0]["grid"])
        self.assertEqual(canonical[101], payload["items"][1]["grid"])

    def test_known_upstream_rename_and_canonical_grid_are_imported(self):
        payload = [{"id": 100, "code": "A", "nameEn": "Old Name", "grid": {"group": "VITALITY", "slot": 3, "side": "RIGHT"}}]
        document = {"items": payload}
        vehicles = {"1": {"_equipmentPreset": "standard"}}
        canonical = {100: {"group": "FIREPOWER", "slot": 1, "side": "LEFT"}}
        with (
            patch.object(sync.ue, "parse_equipment_defs", return_value=({"standard": {100}}, {100: "New Name"})),
            patch.object(sync.ue, "parse_tanks", return_value=vehicles),
            patch.object(sync.ue, "filter_to_business_tiers", return_value=vehicles),
            patch.object(sync.ue, "parse_canonical_grid", return_value=canonical),
            patch.object(sync.ue, "FULLY_MODELED_CODES", {"A"}),
            patch.object(sync.ue, "LOCKED_CODES", set()),
        ):
            sync.ue.sync_upstream_metadata(document, b"equipment", b"tanks")
        self.assertEqual("New Name", payload[0]["nameEn"])
        self.assertEqual(canonical[100], payload[0]["grid"])

    def test_unknown_business_equipment_fails_closed_until_modeled(self):
        payload = {"items": [{"id": 100, "code": "A", "nameEn": "Alpha"}]}
        vehicles = {"1": {"_equipmentPreset": "special"}}
        with (
            patch.object(sync.ue, "parse_equipment_defs", return_value=({"special": {100, 999}}, {100: "Alpha", 999: "New"})),
            patch.object(sync.ue, "parse_tanks", return_value=vehicles),
            patch.object(sync.ue, "filter_to_business_tiers", return_value=vehicles),
            patch.object(sync.ue, "FULLY_MODELED_CODES", {"A"}),
            patch.object(sync.ue, "LOCKED_CODES", set()),
        ):
            with self.assertRaisesRegex(RuntimeError, "BLITZKIT_NEW_BUSINESS_EQUIPMENT_UNMODELED"):
                sync.ue.sync_upstream_metadata(payload, b"equipment", b"tanks")

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
