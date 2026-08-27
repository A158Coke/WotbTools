import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import update_equipment


class UpdateEquipmentParserTest(unittest.TestCase):
    def test_coefficient(self):
        text = "const x = coefficient([hasExample, -0.12]);"
        self.assertEqual(-0.12, update_equipment.coefficient(text, "hasExample"))

    def test_ternary_number(self):
        text = "const x = hasImprovedVentilation ? 0.08 : 0;"
        self.assertEqual(0.08, update_equipment.ternary_number(text, "hasImprovedVentilation"))

    def test_parse_calibrated(self):
        text = """
        type === ShellType.SHELL_TYPE_AP
          ? 1.06
          : type === ShellType.SHELL_TYPE_APCR
            ? 1.06
            : type === ShellType.SHELL_TYPE_HEAT
              ? 1.07
              : 1.07
          : 1;
        """
        self.assertEqual(
            {"AP": 1.06, "APCR": 1.06, "HEAT": 1.07, "HE": 1.07},
            update_equipment.parse_calibrated(text),
        )

    def test_required_business_equipment_ids_rejects_missing_preset(self):
        vehicles = {"1": {"_equipmentPreset": "missing"}}
        with self.assertRaisesRegex(RuntimeError, "BLITZKIT_PRESET_MISSING"):
            update_equipment.required_business_equipment_ids(vehicles, {})

    def test_required_business_equipment_ids_unions_used_presets(self):
        vehicles = {
            "1": {"_equipmentPreset": "a"},
            "2": {"_equipmentPreset": "b"},
            "3": {"_equipmentPreset": "a"},
        }
        names, ids = update_equipment.required_business_equipment_ids(
            vehicles,
            {"a": {100, 101}, "b": {101, 102}, "unused": {999}},
        )
        self.assertEqual({"a", "b"}, names)
        self.assertEqual({100, 101, 102}, ids)

    def test_model_partition_covers_catalog_contract(self):
        expected_codes = {
            "GUN_RAMMER", "IMPROVED_VENTILATION", "CALIBRATED_SHELLS",
            "ENHANCED_GUN_LAYING_DRIVE", "SUPERCHARGER", "VERTICAL_STABILIZER",
            "REFINED_GUN", "IMPROVED_VERTICAL_STABILIZER", "IMPROVED_SUSPENSION",
            "IMPROVED_MODULES", "DEFENSE_SYSTEM", "ENHANCED_ARMOR",
            "IMPROVED_ASSEMBLY", "ENHANCED_TRACKS", "TOOLBOX", "IMPROVED_OPTICS",
            "CAMOUFLAGE_NET", "IMPROVED_CONTROL", "ENGINE_ACCELERATOR",
            "CONSUMABLE_DELIVERY_SYSTEM", "HIGH_END_CONSUMABLES",
        }
        self.assertEqual(
            expected_codes,
            update_equipment.FULLY_MODELED_CODES | update_equipment.LOCKED_CODES,
        )
        self.assertFalse(update_equipment.FULLY_MODELED_CODES & update_equipment.LOCKED_CODES)


if __name__ == "__main__":
    unittest.main()
