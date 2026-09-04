import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import update_equipment


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


def equipment_preset(name, slots):
    slot_bytes = b"".join(
        field_bytes(1, field_varint(1, left) + field_varint(2, right))
        for left, right in slots
    )
    return field_bytes(1, field_bytes(1, name.encode()) + field_bytes(2, slot_bytes))


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

    def test_canonical_grid_uses_default_preset_column_order(self):
        slots = [
            (100, 101), (102, 103), (104, 105),
            (106, 107), (108, 109), (110, 111),
            (112, 113), (114, 115), (116, 117),
        ]
        pb = equipment_preset("defaultPreset", slots)
        grid = update_equipment.parse_canonical_grid(pb)
        self.assertEqual({"group": "FIREPOWER", "slot": 1, "side": "LEFT"}, grid[100])
        self.assertEqual({"group": "VITALITY", "slot": 1, "side": "LEFT"}, grid[102])
        self.assertEqual({"group": "SPECIALIZATION", "slot": 1, "side": "LEFT"}, grid[104])
        self.assertEqual({"group": "FIREPOWER", "slot": 2, "side": "LEFT"}, grid[106])
        self.assertEqual({"group": "SPECIALIZATION", "slot": 3, "side": "RIGHT"}, grid[117])

    def test_canonical_grid_ignores_special_preset(self):
        special = equipment_preset("specialPreset", [(999, 998)] * 9)
        default = equipment_preset("defaultPreset", [(100 + i * 2, 101 + i * 2) for i in range(9)])
        grid = update_equipment.parse_canonical_grid(special + default)
        self.assertNotIn(999, grid)
        self.assertIn(100, grid)

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
            "CONSUMABLE_DELIVERY_SYSTEM", "HIGH_END_CONSUMABLES", "IMPROVED_MODULES_PLUS",
        }
        self.assertEqual(
            expected_codes,
            update_equipment.FULLY_MODELED_CODES | update_equipment.LOCKED_CODES,
        )
        self.assertFalse(update_equipment.FULLY_MODELED_CODES & update_equipment.LOCKED_CODES)


if __name__ == "__main__":
    unittest.main()
