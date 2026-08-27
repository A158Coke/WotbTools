# -*- coding: utf-8 -*-
"""validate_tankopedia_equipment.py 单元测试。"""

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import validate_tankopedia_equipment as validator


class TankopediaEquipmentCoverageTest(unittest.TestCase):
    def test_known_preset_and_ids_pass(self):
        vehicles = {"7": {"id": 7, "_equipmentPreset": "linePreset"}}
        presets = {"linePreset": {100, 101}}
        equipment_map = {100: "RAMMER", 101: "VENT"}
        self.assertTrue(
            validator.validate_vehicle_equipment_coverage(vehicles, presets, equipment_map)
        )

    def test_unknown_equipment_id_fails_closed(self):
        vehicles = {"77": {"id": 77, "_equipmentPreset": "newLinePreset"}}
        presets = {"newLinePreset": {100, 130}}
        equipment_map = {100: "RAMMER"}
        with self.assertRaisesRegex(RuntimeError, "TANKOPEDIA_UNKNOWN_EQUIPMENT_ID") as ctx:
            validator.validate_vehicle_equipment_coverage(vehicles, presets, equipment_map)
        self.assertIn("vehicle=77", str(ctx.exception))
        self.assertIn("130", str(ctx.exception))

    def test_missing_upstream_preset_fails_closed(self):
        vehicles = {"88": {"id": 88, "_equipmentPreset": "brandNewPreset"}}
        with self.assertRaisesRegex(RuntimeError, "TANKOPEDIA_EQUIPMENT_PRESET_MISSING") as ctx:
            validator.validate_vehicle_equipment_coverage(vehicles, {}, {100: "RAMMER"})
        self.assertIn("brandNewPreset", str(ctx.exception))

    def test_vehicle_without_preset_is_allowed(self):
        vehicles = {"99": {"id": 99, "_equipmentPreset": ""}}
        self.assertTrue(
            validator.validate_vehicle_equipment_coverage(vehicles, {}, {})
        )


if __name__ == "__main__":
    unittest.main()
