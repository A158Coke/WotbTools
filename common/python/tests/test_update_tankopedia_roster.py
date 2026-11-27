# -*- coding: utf-8 -*-
"""Focused Tankopedia regression tests (stdlib unittest, no live network)."""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import update_tankopedia as ut
class RosterTest(unittest.TestCase):
    """完整车辆名册 tank_ids.json：沿用 alias 校验的全等级 tank_id ↔ 名字契约。

    消费方是 common/tank_aliases.json 的 validator 与其维护流程（按 id 配 alias、按名字查 id）。
    tier 文件与名册均覆盖全等级；名册只用于离线名称/ID 校验。
    """

    def payload(self, **kwargs):
        vehicles = {
            "1": {"id": 1, "name": "T-34", "tier": 5},
            "9297": {"id": 9297, "name": "FV215b 183", "tier": 10},
            "17": {"id": 17, "name": " Pz. IV G ", "tier": 5},
        }
        return ut.roster_payload(vehicles, "2026-10-16T00:00:00+00:00", **kwargs)

    def test_covers_every_tier_sorted_by_id(self):
        payload = self.payload()
        self.assertEqual(list(payload["vehicles"]), ["1", "17", "9297"])
        self.assertEqual(payload["vehicles"]["17"], "Pz. IV G")
        self.assertEqual(payload["meta"]["count"], 3)

    def test_records_snapshot_provenance(self):
        payload = self.payload(game_version="11.21.0", source_hashes={"tanks": "abc123", "game": "zzz"})
        self.assertEqual(payload["meta"]["source_game_version"], "11.21.0")
        self.assertEqual(payload["meta"]["source_hashes"], {"tanks": "abc123"})

    def test_drops_entries_without_usable_id_or_name(self):
        vehicles = {
            "a": {"id": 0, "name": "zero"},
            "b": {"id": 5, "name": "   "},
            "c": {"name": "no id"},
            "d": {"id": 7, "name": "ok"},
            "e": "not a dict",
        }
        self.assertEqual(ut.roster_payload(vehicles, "t")["vehicles"], {"7": "ok"})

    def test_empty_roster_fails(self):
        with self.assertRaisesRegex(RuntimeError, "TANK_ROSTER_EMPTY"):
            ut.validate_roster({"vehicles": {}}, {})

    def test_count_drop_fails(self):
        def roster(size):
            return {"vehicles": {str(i): "v%d" % i for i in range(size)}}
        old = roster(100)
        with self.assertRaisesRegex(RuntimeError, "TANK_ROSTER_COUNT_DROP"):
            ut.validate_roster(roster(70), old)
        self.assertTrue(ut.validate_roster(roster(85), old))
        self.assertTrue(ut.validate_roster(roster(120), old))

    def test_committed_roster_covers_tier_files_with_matching_names(self):
        """已入库名册：tier 文件里的每辆车都必须同名出现在名册中（方向性断言）。

        反向不成立且不应断言——名册可能来自更新的快照（新车先出现在名册里）。
        """
        roster = ut.load_existing_roster(ut.REPO_COMMON_DIR)["vehicles"]
        tier_ids = set()
        for filename in ut.TIER_FILES.values():
            with open(os.path.join(ut.REPO_COMMON_DIR, filename), encoding="utf-8") as file:
                for vehicle in json.load(file)["vehicles"]:
                    tier_ids.add(vehicle["id"])
                    self.assertEqual(
                        roster.get(str(vehicle["id"])), vehicle["name"],
                        "roster name drifted for tank_id=%s" % vehicle["id"],
                    )
        self.assertGreaterEqual(len(roster), len(tier_ids))
