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

    def test_sync_ids_matches_english_name(self):
        payload = {"items": [{"id": 999, "code": "GUN_RAMMER", "nameEn": "Gun Rammer", "effects": [{}]}]}
        update_equipment.sync_ids(payload, {100: "Gun Rammer"})
        self.assertEqual(100, payload["items"][0]["id"])


if __name__ == "__main__":
    unittest.main()
