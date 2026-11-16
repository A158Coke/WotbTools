# -*- coding: utf-8 -*-
"""Focused Tankopedia regression tests (stdlib unittest, no live network)."""
import json
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import update_tankopedia as ut
class LoadExistingDataTest(unittest.TestCase):
    def test_missing_or_empty_path_returns_empty(self):
        self.assertEqual(ut.load_existing_data(""), {})
        self.assertEqual(ut.load_existing_data("/nonexistent/path.json"), {})

    def test_non_dict_json_returns_empty(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            f.write("[1, 2, 3]")
            path = f.name
        try:
            self.assertEqual(ut.load_existing_data(path), {})
        finally:
            os.remove(path)

    def test_new_vehicles_format(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "old.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"meta": {}, "vehicles": [
                    {"id": 49, "name": "Type 59", "extraInfo": "首上可靠"},
                ]}, f)
            data = ut.load_existing_data(path)
            self.assertEqual(data, {"49": {"id": 49, "name": "Type 59", "extraInfo": "首上可靠"}})

    def test_old_data_format(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "old.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"meta": {}, "data": {"1": {"name": "A"}}}, f)
            self.assertEqual(ut.load_existing_data(path), {"1": {"name": "A"}})

    def test_load_existing_dir_reads_all_tier_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            with open(os.path.join(tmp, "tankopedia-tier7.json"), "w", encoding="utf-8") as f:
                json.dump({"vehicles": [{"id": 7, "extraInfo": "七级"}]}, f)
            with open(os.path.join(tmp, "tankopedia-tier10.json"), "w", encoding="utf-8") as f:
                json.dump({"vehicles": [{"id": 10, "extraInfo": "十级"}]}, f)
            data = ut.load_existing_data_dir(tmp)
            self.assertEqual(data["7"]["extraInfo"], "七级")
            self.assertEqual(data["10"]["extraInfo"], "十级")

class KnowledgePreservationTest(unittest.TestCase):
    def test_old_extra_info_preserved(self):
        old = {"1": {"extraKnowledge": "点灯位"}, "2": {"extraInfo": "炮塔弱点"}}
        new = {"1": {"name": "A"}, "2": {"name": "B"}, "3": {"name": "C"}}
        merged = ut.merge_extra_info(new, old)
        self.assertEqual(merged["1"]["extraInfo"], "点灯位")
        self.assertEqual(merged["2"]["extraInfo"], "炮塔弱点")
        self.assertEqual(merged["3"]["extraInfo"], "")

    def test_removed_vehicle_disappears(self):
        old = {"1": {"extraInfo": "知识"}, "2": {"extraInfo": "旧车知识"}}
        new = {"1": {"name": "A"}}
        merged = ut.merge_extra_info(new, old)
        self.assertNotIn("2", merged)
        ok, old_count, preserved = ut.verify_knowledge_preservation(old, merged)
        self.assertTrue(ok)
        self.assertEqual(old_count, 2)
        self.assertEqual(preserved, 1)

    def test_knowledge_loss_detected(self):
        old = {"1": {"extraInfo": "重要知识"}}
        new = {"1": {"name": "A"}}
        merged = ut.merge_extra_info(new, old)
        del merged["1"]["extraInfo"]
        ok, _, _ = ut.verify_knowledge_preservation(old, merged)
        self.assertFalse(ok)

    def test_merge_fails_when_entry_not_preservable(self):
        old = {"1": {"extraInfo": "知识"}}
        new = {"1": "not-a-dict"}
        with self.assertRaisesRegex(RuntimeError, "TANKOPEDIA_KNOWLEDGE_LOST"):
            ut.merge_extra_info(new, old)

class IntegrityGateTest(unittest.TestCase):
    @staticmethod
    def vehicle(tank_id, tier=7, **overrides):
        vehicle = {"id": tank_id, "tier": tier, "name": "Tank",
                   "hp": 1000, "guns": [{"gunId": 1}]}
        vehicle.update(overrides)
        return vehicle

    def test_empty_fails(self):
        with self.assertRaisesRegex(RuntimeError, "TANKOPEDIA_EMPTY"):
            ut.validate_integrity({}, {})

    def test_duplicate_id_fails(self):
        data = {"1": self.vehicle(1), "2": self.vehicle(1)}
        with self.assertRaisesRegex(RuntimeError, "TANKOPEDIA_DUPLICATE_ID"):
            ut.validate_integrity(data, {})

    def test_missing_fields_fail(self):
        with self.assertRaisesRegex(RuntimeError, "TANKOPEDIA_MISSING_ID"):
            ut.validate_integrity({"1": self.vehicle(None)}, {})
        with self.assertRaisesRegex(RuntimeError, "TANKOPEDIA_MISSING_NAME"):
            ut.validate_integrity({"1": self.vehicle(1, name="")}, {})
        with self.assertRaisesRegex(RuntimeError, "TANKOPEDIA_MISSING_HP"):
            ut.validate_integrity({"1": self.vehicle(1, hp=None)}, {})
        with self.assertRaisesRegex(RuntimeError, "TANKOPEDIA_MISSING_GUN"):
            ut.validate_integrity({"1": self.vehicle(1, guns=[])}, {})

    def test_tier_out_of_range_fails(self):
        with self.assertRaisesRegex(RuntimeError, "TANKOPEDIA_TIER_OUT_OF_RANGE"):
            ut.validate_integrity({"1": self.vehicle(1, tier=11)}, {})

    def test_all_supported_tiers_pass(self):
        for tier in range(1, 11):
            self.assertTrue(ut.validate_integrity({"1": self.vehicle(1, tier=tier)}, {}))
        with self.assertRaisesRegex(RuntimeError, "TANKOPEDIA_TIER_OUT_OF_RANGE"):
            ut.validate_integrity({"1": self.vehicle(1, tier=0)}, {})

    def test_total_count_drop_fails(self):
        old = {str(i): self.vehicle(i) for i in range(1, 101)}
        new = {str(i): self.vehicle(i) for i in range(1, 11)}
        with self.assertRaisesRegex(RuntimeError, "TANKOPEDIA_COUNT_DROP"):
            ut.validate_integrity(new, old)

    def test_per_tier_drop_fails(self):
        # 总量 100 -> 80（允许），但 tier7 50 -> 30（跌破 0.8 阈值）必须失败
        old = {str(i): self.vehicle(i, tier=7) for i in range(1, 51)}
        old.update({str(i): self.vehicle(i, tier=8) for i in range(51, 101)})
        new = {str(i): self.vehicle(i, tier=7) for i in range(1, 31)}
        new.update({str(i): self.vehicle(i, tier=8) for i in range(51, 101)})
        with self.assertRaisesRegex(RuntimeError, "TANKOPEDIA_TIER_DROP"):
            ut.validate_integrity(new, old)

    def test_normal_and_small_real_deletion_pass(self):
        old = {str(i): self.vehicle(i) for i in range(1, 101)}
        new = {str(i): self.vehicle(i) for i in range(1, 91)}  # 10% 真实删除可接受
        self.assertTrue(ut.validate_integrity(new, old))
