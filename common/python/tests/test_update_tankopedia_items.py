# -*- coding: utf-8 -*-
"""Focused Tankopedia regression tests (stdlib unittest, no live network)."""
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import update_tankopedia as ut
from _tankopedia_test_fixtures import (
    shell, gun, turret, tank_data, root, filter_tiers, filter_categories,
    filter_nations, item_def, item_root, equipment_preset, equipment_item,
    equipment_root,
)

class EquipmentTest(unittest.TestCase):
    def test_allowed_equipment_from_preset(self):
        # VK 72.01 形状：特殊预设带 俯角/履带齿 专属装备（122/123）
        tanks_pb = root(tank_data(
            58641, 10, 2, 2100, turret(600,
                gun(100, [shell("ap", 460, 250)])),
            name="VK 72.01", nation="germany",
            equipment_preset="DrumGunPitchLimitsPreset",
        ))
        equipment_pb = equipment_root(
            equipment_preset("DrumGunPitchLimitsPreset", [(102, 103), (122, 123)]),
            equipment_preset("defaultPreset", [(100, 103)]),
            equipment_item(100, "Gun Rammer"),
            equipment_item(102, "Improved Ventilation"),
            equipment_item(103, "Calibrated Shells"),
            equipment_item(122, "Improved Vertical Stabilizer"),
            equipment_item(123, "Improved Suspension"),
        )
        presets, _ = ut.parse_equipment_defs(equipment_pb)
        self.assertEqual(presets["DrumGunPitchLimitsPreset"], {102, 103, 122, 123})

        with tempfile.TemporaryDirectory() as tmp:
            catalog = os.path.join(tmp, "catalog")
            os.makedirs(catalog)
            with open(os.path.join(catalog, "equipment.json"), "w", encoding="utf-8") as f:
                json.dump({"items": [
                    {"id": 100, "code": "GUN_RAMMER"},
                    {"id": 102, "code": "IMPROVED_VENTILATION"},
                    {"id": 103, "code": "CALIBRATED_SHELLS"},
                    {"id": 122, "code": "IMPROVED_VERTICAL_STABILIZER"},
                    {"id": 123, "code": "IMPROVED_SUSPENSION"},
                ]}, f)
            with mock.patch.object(ut, "CATALOG_DIR", catalog):
                equipment_map = ut.load_equipment_catalog()

        vehicles = ut.apply_equipment(ut.parse_tanks(tanks_pb), presets, equipment_map)
        vehicle = vehicles["58641"]
        self.assertEqual(vehicle["allowedEquipment"], [
            "CALIBRATED_SHELLS", "IMPROVED_SUSPENSION",
            "IMPROVED_VENTILATION", "IMPROVED_VERTICAL_STABILIZER",
        ])
        out = ut.vehicle_output(vehicle)
        self.assertNotIn("_equipmentPreset", out)
        self.assertNotIn("priority", out)

    def test_unknown_preset_yields_empty_equipment(self):
        tanks_pb = root(tank_data(
            9489, 10, 2, 2070, turret(680,
                gun(269329, [shell("ap", 460, 256)])),
            name="E 100", nation="germany", equipment_preset="no-such-preset",
        ))
        vehicles = ut.apply_equipment(ut.parse_tanks(tanks_pb), {}, {})
        self.assertEqual(vehicles["9489"]["allowedEquipment"], [])

class ItemFilterTest(unittest.TestCase):
    @staticmethod
    def vehicle(tier=8, tank_id=49, nation="china", clip=False):
        return {"tier": tier, "id": tank_id, "nation": nation,
                "guns": [{"clip": clip}]}

    def test_tiers_and_nations_include_are_and(self):
        # 小口粮（中国）：tier 4-10 AND nation china
        item = {"id": 14, "name": "Tofu Soup",
                "include": [("tiers", (4, 10)), ("nations", ["china"])],
                "exclude": []}
        self.assertTrue(ut.item_allowed(self.vehicle(), item))
        self.assertFalse(ut.item_allowed(self.vehicle(nation="germany"), item))
        self.assertFalse(ut.item_allowed(self.vehicle(tier=3), item))

    def test_ids_include(self):
        item = {"id": 28, "name": "Sandbag Armor",
                "include": [("ids", [3153, 3921, 49])], "exclude": []}
        self.assertTrue(ut.item_allowed(self.vehicle(), item))
        self.assertFalse(ut.item_allowed(self.vehicle(tank_id=999), item))

    def test_clip_category_exclude(self):
        # Adrenaline：非弹夹车可用
        item = {"id": 18, "name": "Adrenaline",
                "include": [("tiers", (4, 10))],
                "exclude": [("categories", [0])]}
        self.assertTrue(ut.item_allowed(self.vehicle(clip=False), item))
        self.assertFalse(ut.item_allowed(self.vehicle(clip=True), item))

    def test_exclude_ids(self):
        # First Aid Kit：除指定车外全部可用
        item = {"id": 3, "name": "First Aid Kit",
                "include": [("tiers", (4, 10))],
                "exclude": [("ids", [49])]}
        self.assertTrue(ut.item_allowed(self.vehicle(tank_id=50), item))
        self.assertFalse(ut.item_allowed(self.vehicle(tank_id=49), item))

    def test_empty_include_matches_all(self):
        item = {"id": 1, "name": "Automatic Fire Extinguisher",
                "include": [], "exclude": []}
        self.assertTrue(ut.item_allowed(self.vehicle(), item))

    def test_apply_items_maps_catalog_ids(self):
        provisions_pb = item_root(
            item_def(0, "Field Rations", include=[filter_nations(["other"])]),
            item_def(18, "Standard Fuel", include=[filter_tiers(4, 10)]),
        )
        consumables_pb = item_root(
            item_def(1, "Automatic Fire Extinguisher"),
            item_def(18, "Adrenaline", exclude=[filter_categories([0])]),
        )
        with tempfile.TemporaryDirectory() as tmp:
            catalog = os.path.join(tmp, "wotb-item-catalog-json")
            os.makedirs(catalog)
            with open(os.path.join(catalog, "provisions.json"), "w", encoding="utf-8") as f:
                json.dump({"items": [
                    {"id": "SMALL_FOOD", "sourceIds": [0]},
                    {"id": "STANDARD_FUEL", "sourceIds": [18]},
                ]}, f)
            with open(os.path.join(catalog, "consumables.json"), "w", encoding="utf-8") as f:
                json.dump({"items": [
                    {"id": 1, "code": "AUTOMATIC_FIRE_EXTINGUISHER"},
                    {"id": 18, "code": "ADRENALINE"},
                ]}, f)
            with mock.patch.object(ut, "CATALOG_DIR", catalog):
                prov_map, cons_map = ut.load_catalog()
                vehicles = ut.apply_items(
                    {"49": self.vehicle(nation="other")},
                    ut.parse_item_defs(provisions_pb),
                    ut.parse_item_defs(consumables_pb),
                    prov_map, cons_map,
                )
        v = vehicles["49"]
        self.assertEqual(v["allowedProvision"], ["SMALL_FOOD", "STANDARD_FUEL"])
        self.assertEqual(v["allowedConsumables"], ["ADRENALINE", "AUTOMATIC_FIRE_EXTINGUISHER"])
        # 弹夹车：Adrenaline 被 CLIP 排除
        vehicles_clip = ut.apply_items(
            {"49": self.vehicle(clip=True)},
            [], ut.parse_item_defs(consumables_pb),
            {}, {1: "AUTOMATIC_FIRE_EXTINGUISHER", 18: "ADRENALINE"},
        )
        self.assertEqual(vehicles_clip["49"]["allowedConsumables"],
                         ["AUTOMATIC_FIRE_EXTINGUISHER"])
