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
    shell, gun, turret, tank_data, root, filter_nations, item_def, item_root,
    equipment_preset, equipment_item, equipment_root,
)

class MainPathTest(unittest.TestCase):
    def test_existing_output_different_paths_and_knowledge_preserved(self):
        tanks_pb = root(tank_data(
            1, 10, 2, 2070, turret(580,
                gun(500, [shell("ap", 420, 258), shell("hc_premium", 360, 340), shell("he", 500, 68)])),
            name="IS-4", nation="ussr",
        ))
        provisions_pb = item_root(item_def(0, "Field Rations", include=[filter_nations(["other"])]))
        consumables_pb = item_root(item_def(1, "Automatic Fire Extinguisher"))
        equipment_pb = equipment_root(
            equipment_preset("defaultPreset", [(100, 103), (122, 123)]),
            equipment_item(100, "Gun Rammer"),
            equipment_item(103, "Calibrated Shells"),
            equipment_item(122, "Improved Vertical Stabilizer"),
            equipment_item(123, "Improved Suspension"),
        )

        class FakeResp:
            def __init__(self, data):
                self._data = data

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def read(self):
                return self._data

        def fake_urlopen(url, timeout=60):
            if "tanks.pb" in url:
                return FakeResp(tanks_pb)
            if "provisions.pb" in url:
                return FakeResp(provisions_pb)
            if "consumables.pb" in url:
                return FakeResp(consumables_pb)
            if "equipment.pb" in url:
                return FakeResp(equipment_pb)
            raise AssertionError("unexpected url: " + url)

        with tempfile.TemporaryDirectory() as tmp:
            old_dir = os.path.join(tmp, "old")
            new_dir = os.path.join(tmp, "new")
            os.makedirs(old_dir)
            os.makedirs(new_dir)
            old_path = os.path.join(old_dir, "tankopedia-tier10.json")
            with open(old_path, "w", encoding="utf-8") as f:
                json.dump({"meta": {}, "vehicles": [
                    {"id": 1, "extraInfo": "保留我"},
                ]}, f)
            with open(old_path, "rb") as f:
                old_bytes_before = f.read()

            with mock.patch.object(ut.urllib.request, "urlopen", side_effect=fake_urlopen):
                rc = ut.main(["--existing-dir", old_dir, "--output-dir", new_dir])

            self.assertEqual(rc, 0)
            with open(old_path, "rb") as f:
                self.assertEqual(f.read(), old_bytes_before)
            self.assertEqual(
                sorted(os.listdir(new_dir)),
                sorted([*ut.TIER_FILES.values(), ut.ROSTER_FILE]),
            )
            with open(os.path.join(new_dir, "tankopedia-tier10.json"), encoding="utf-8") as f:
                payload = json.load(f)
            self.assertEqual(payload["meta"]["count"], 1)
            self.assertEqual(payload["meta"]["tier"], 10)
            vehicle = payload["vehicles"][0]
            self.assertEqual(vehicle["id"], 1)
            self.assertEqual(vehicle["extraInfo"], "保留我")
            self.assertEqual(vehicle["hp"], 2650)
            self.assertEqual(vehicle["alphaDamage"], 420)
            self.assertEqual(vehicle["guns"][0]["shells"][0]["penetration"], 258)
            self.assertEqual(vehicle["allowedEquipment"], [
                "CALIBRATED_SHELLS", "GUN_RAMMER",
                "IMPROVED_SUSPENSION", "IMPROVED_VERTICAL_STABILIZER",
            ])

    def test_main_includes_lower_tiers_and_preserves_high_tier_data(self):
        tanks_pb = root(
            tank_data(1, 5, 1, 496, turret(124,
                gun(100, [shell("ap", 140, 85)])),
                name="T-34", nation="ussr"),
            tank_data(1585, 8, 1, 1300, turret(360,
                gun(817, [shell("ap", 200, 100)], tier=6),
                gun(1073, [shell("ap", 200, 100)], tier=6),
                gun(1329, [shell("ap", 280, 100)], tier=7),
                gun(2353, [shell("ap", 400, 100)], tier=8),
                gun(2609, [shell("ap", 280, 100)], tier=8)),
                name="T-34-2", nation="china"),
            tank_data(29985, 10, 2, 3400, turret(1000,
                gun(272929, [shell("ap", 400, 252)])),
                name="SPHT", nation="usa"),
        )
        provisions_pb = item_root(item_def(0, "Field Rations", include=[filter_nations(["other"])]))
        consumables_pb = item_root(item_def(1, "Automatic Fire Extinguisher"))
        equipment_pb = equipment_root(
            equipment_preset("defaultPreset", [(100, 103)]),
            equipment_item(100, "Gun Rammer"),
            equipment_item(103, "Calibrated Shells"),
        )

        class FakeResp:
            def __init__(self, data):
                self._data = data

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def read(self):
                return self._data

        def fake_urlopen(url, timeout=60):
            if "tanks.pb" in url:
                return FakeResp(tanks_pb)
            if "provisions.pb" in url:
                return FakeResp(provisions_pb)
            if "consumables.pb" in url:
                return FakeResp(consumables_pb)
            if "equipment.pb" in url:
                return FakeResp(equipment_pb)
            raise AssertionError("unexpected url: " + url)

        with tempfile.TemporaryDirectory() as tmp:
            old_dir = os.path.join(tmp, "old")
            new_dir = os.path.join(tmp, "new")
            os.makedirs(old_dir)
            os.makedirs(new_dir)
            with open(os.path.join(old_dir, "tankopedia-tier8.json"), "w", encoding="utf-8") as f:
                json.dump({"meta": {}, "vehicles": [
                    {"id": 1585, "extraInfo": "保留我"},
                ]}, f)

            with mock.patch.object(ut.urllib.request, "urlopen", side_effect=fake_urlopen):
                rc = ut.main(["--existing-dir", old_dir, "--output-dir", new_dir])

            self.assertEqual(rc, 0)
            self.assertEqual(
                sorted(os.listdir(new_dir)),
                sorted([*ut.TIER_FILES.values(), ut.ROSTER_FILE]),
            )
            files = {}
            for name in ut.TIER_FILES.values():
                with open(os.path.join(new_dir, name), encoding="utf-8") as f:
                    files[name] = json.load(f)
            all_ids = {v["id"] for payload in files.values() for v in payload["vehicles"]}
            self.assertIn(1, all_ids)
            lower = files["tankopedia-tier5.json"]["vehicles"][0]
            self.assertEqual(lower["name"], "T-34")
            self.assertEqual(lower["hp"], 620)
            self.assertNotIn("allowedEquipment", lower)
            self.assertNotIn("allowedConsumables", lower)
            self.assertNotIn("_equipmentPreset", lower)
            with open(os.path.join(new_dir, ut.ROSTER_FILE), encoding="utf-8") as f:
                roster = json.load(f)
            self.assertEqual(roster["vehicles"]["1"], "T-34")
            self.assertIn("1585", roster["vehicles"])
            self.assertEqual(roster["meta"]["count"], len(roster["vehicles"]))
            tier8_vehicles = files["tankopedia-tier8.json"]["vehicles"]
            t82 = next(v for v in tier8_vehicles if v["id"] == 1585)
            self.assertEqual(t82["alphaDamage"], 400)
            self.assertEqual(t82["extraInfo"], "保留我")
            self.assertEqual(len(t82["guns"]), 5)
            spht = next(v for v in files["tankopedia-tier10.json"]["vehicles"] if v["id"] == 29985)
            self.assertEqual(spht["alphaDamage"], 400)
            self.assertEqual(files["tankopedia-tier7.json"]["meta"]["count"], 0)
            self.assertEqual(files["tankopedia-tier9.json"]["meta"]["count"], 0)
