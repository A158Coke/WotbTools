# -*- coding: utf-8 -*-
"""update_tankopedia.py 单元测试（标准库 unittest，无网络依赖）。"""

import io
import json
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import update_tankopedia as ut


class FakeResponse:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode("utf-8")

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self):
        return self._body


class FakeOpener:
    """顺序返回预设页面的假 urlopen opener。"""

    def __init__(self, pages):
        self._pages = list(pages)

    def open(self, url, timeout=None):
        return FakeResponse(self._pages.pop(0))


def page_with_ids(ids):
    return {"status": "ok", "data": {str(tank_id): {} for tank_id in ids}}


def full_page(prefix, size=100):
    return page_with_ids(range(prefix, prefix + size))


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

    def test_unwraps_data_field(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = os.path.join(tmp, "old.json")
            with open(path, "w", encoding="utf-8") as f:
                json.dump({"meta": {}, "data": {"1": {"name": "A"}}}, f)
            self.assertEqual(ut.load_existing_data(path), {"1": {"name": "A"}})


class KnowledgePreservationTest(unittest.TestCase):
    def test_old_extra_knowledge_preserved(self):
        old = {"1": {"extraKnowledge": "点灯位"}, "2": {"extraKnowledge": "炮塔弱点"}}
        new = {"1": {"name": "A"}, "2": {"name": "B"}, "3": {"name": "C"}}
        merged = ut.merge_extra_knowledge(new, old)
        self.assertEqual(merged["1"]["extraKnowledge"], "点灯位")
        self.assertEqual(merged["2"]["extraKnowledge"], "炮塔弱点")
        self.assertNotIn("extraKnowledge", merged["3"])

    def test_new_vehicle_has_no_fabricated_knowledge(self):
        vehicles = {"42": {"name": "X", "tier": 10, "type": "lightTank", "nation": "china",
                           "default_profile": {"hp": 1500}}}
        data = ut.transform(vehicles, "first", {})
        self.assertNotIn("extraKnowledge", data["42"])
        self.assertEqual(data["42"]["hp"], 1500)

    def test_removed_vehicle_disappears(self):
        old = {"1": {"extraKnowledge": "知识"}, "2": {"extraKnowledge": "旧车知识"}}
        new = {"1": {"name": "A"}}  # "2" 被 WG 官方删除
        merged = ut.merge_extra_knowledge(new, old)
        self.assertNotIn("2", merged)
        ok, old_count, preserved = ut.verify_knowledge_preservation(old, merged)
        self.assertTrue(ok)
        self.assertEqual(old_count, 2)
        self.assertEqual(preserved, 1)

    def test_knowledge_loss_detected(self):
        old = {"1": {"extraKnowledge": "重要知识"}}
        new = {"1": {"name": "A"}}
        merged = ut.merge_extra_knowledge(new, old)
        del merged["1"]["extraKnowledge"]  # 模拟合并后被破坏
        ok, _, _ = ut.verify_knowledge_preservation(old, merged)
        self.assertFalse(ok)

    def test_merge_fails_when_entry_not_preservable(self):
        old = {"1": {"extraKnowledge": "知识"}}
        new = {"1": "not-a-dict"}
        with self.assertRaisesRegex(RuntimeError, "TANKOPEDIA_KNOWLEDGE_LOST"):
            ut.merge_extra_knowledge(new, old)


class PathSeparationTest(unittest.TestCase):
    def test_existing_output_different_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_path = os.path.join(tmp, "old.json")
            new_path = os.path.join(tmp, "new.json")
            with open(old_path, "w", encoding="utf-8") as f:
                json.dump({"meta": {}, "data": {"1": {"extraKnowledge": "保留我"}}}, f)
            with open(old_path, "rb") as f:
                old_bytes_before = f.read()
            vehicles = {
                "1": {"name": "T1", "tier": 10, "type": "heavyTank", "nation": "germany",
                      "default_profile": {"hp": 2000, "shells": [
                          {"type": "ARMOR_PIERCING", "damage": 320},
                          {"type": "HIGH_EXPLOSIVE", "damage": 45},
                      ]}},
            }
            env_patch = mock.patch.dict(os.environ, {"WG_APPLICATION_ID": "test-id"})
            fetch_patch = mock.patch.object(ut, "fetch_vehicles", return_value=(vehicles, 1))
            with env_patch, fetch_patch:
                rc = ut.main([
                    "--existing", old_path,
                    "--output", new_path,
                    "--min-tier", "1",
                    "--alpha-rule", "first",
                ])
            self.assertEqual(rc, 0)
            with open(old_path, "rb") as f:
                self.assertEqual(f.read(), old_bytes_before)  # 旧文件未被修改
            with open(new_path, encoding="utf-8") as f:
                payload = json.load(f)
            self.assertEqual(payload["data"]["1"]["extraKnowledge"], "保留我")
            self.assertEqual(payload["data"]["1"]["alphaDamage"], 320)


class PaginationTest(unittest.TestCase):
    def test_single_full_response_terminates(self):
        # 真实契约：接口忽略 limit/offset，单次响应返回完整数据集（meta.count 即全集）
        payload = {"status": "ok", "meta": {"count": 529},
                   "data": {str(i): {} for i in range(529)}}
        opener = FakeOpener([payload])
        data, pages = ut.fetch_vehicles("app", "asia", "fields", "zh-cn", opener=opener)
        self.assertEqual(pages, 1)
        self.assertEqual(len(data), 529)

    def test_second_page_accumulates(self):
        opener = FakeOpener([full_page(0), page_with_ids([200, 201, 202])])
        data, pages = ut.fetch_vehicles("app", "asia", "fields", "zh-cn", opener=opener)
        self.assertEqual(pages, 2)
        self.assertEqual(len(data), 103)
        self.assertIn("0", data)
        self.assertIn("202", data)

    def test_duplicate_page_raises_no_progress(self):
        opener = FakeOpener([full_page(0), full_page(0)])
        with self.assertRaisesRegex(RuntimeError, "WG_PAGINATION_NO_PROGRESS"):
            ut.fetch_vehicles("app", "asia", "fields", "zh-cn", opener=opener)

    def test_page_limit_exceeded(self):
        opener = FakeOpener([full_page(i * 100) for i in range(101)])
        with mock.patch.object(ut, "MAX_PAGES", 3):
            with self.assertRaisesRegex(RuntimeError, "WG_PAGINATION_PAGE_LIMIT_EXCEEDED"):
                ut.fetch_vehicles("app", "asia", "fields", "zh-cn", opener=opener)

    def test_pagination_log_sanitized(self):
        opener = FakeOpener([full_page(0), page_with_ids([200, 201])])
        buffer = io.StringIO()
        with mock.patch("sys.stdout", buffer):
            ut.fetch_vehicles("SECRET-APP-ID", "asia", "fields", "zh-cn", opener=opener)
        output = buffer.getvalue()
        self.assertNotIn("SECRET-APP-ID", output)
        self.assertIn("page=1", output)
        self.assertIn("cumulative=100", output)


class AlphaDamageTest(unittest.TestCase):
    def test_alpha_takes_first_not_max(self):
        profile = {"shells": [
            {"type": "ARMOR_PIERCING", "damage": 320},
            {"type": "HOLLOW_CHARGE", "damage": 45},
            {"type": "HIGH_EXPLOSIVE", "damage": 400},
        ]}
        self.assertEqual(ut.alpha_from_profile(profile, "first"), 320)  # 不是 max=400
        self.assertIsNone(ut.alpha_from_profile(profile, "conservative"))

    def test_conservative_keeps_old_value(self):
        old = {"9": {"alphaDamage": 400}}
        vehicles = {
            "9": {"name": "T", "tier": 10, "type": "heavyTank", "nation": "germany",
                  "default_profile": {"shells": [
                      {"type": "ARMOR_PIERCING", "damage": 320},
                      {"type": "HIGH_EXPLOSIVE", "damage": 45},
                  ]}},
        }
        data = ut.transform(vehicles, "conservative", old)
        self.assertEqual(data["9"]["alphaDamage"], 400)

    def test_conservative_new_vehicle_missing_alpha(self):
        vehicles = {
            "9": {"name": "T", "tier": 10, "type": "heavyTank", "nation": "germany",
                  "default_profile": {"shells": [
                      {"type": "ARMOR_PIERCING", "damage": 320},
                      {"type": "HIGH_EXPLOSIVE", "damage": 45},
                  ]}},
        }
        data = ut.transform(vehicles, "conservative", {})
        self.assertNotIn("alphaDamage", data["9"])

    def test_alpha_uses_first_standard_shell_of_real_shape(self):
        # IS-4 真实响应形状：首发 AP 420，HE 500 在后——取 420 而非 500
        profile = {"shells": [
            {"type": "ARMOR_PIERCING", "damage": 420},
            {"type": "HOLLOW_CHARGE", "damage": 360},
            {"type": "HIGH_EXPLOSIVE", "damage": 500},
        ]}
        self.assertEqual(ut.alpha_from_profile(profile, "first"), 420)


class ApiErrorLogTest(unittest.TestCase):
    def test_error_log_does_not_contain_app_id(self):
        bad = {
            "status": "error",
            "error": {
                "code": 407,
                "message": "INVALID_IP_ADDRESS",
                "field": "application_id",
                "value": "SECRET-APP-ID",
            },
        }
        opener = FakeOpener([bad])
        with self.assertRaises(RuntimeError) as ctx:
            ut.http_get_vehicles(
                "https://api.wotblitz.asia/wotb/encyclopedia/vehicles/?application_id=SECRET-APP-ID",
                "asia",
                opener=opener,
            )
        self.assertNotIn("SECRET-APP-ID", str(ctx.exception))
        self.assertIn("WG_API_ERROR", str(ctx.exception))


class MinTierTest(unittest.TestCase):
    def test_min_tier_filters(self):
        data = {"1": {"tier": 5}, "2": {"tier": 7}, "3": {"tier": 10}}
        self.assertEqual(set(ut.filter_by_min_tier(data, 7)), {"2", "3"})
        self.assertEqual(set(ut.filter_by_min_tier(data, 1)), set(data))


class FallbackTest(unittest.TestCase):
    def test_fallback_fills_missing_vehicle(self):
        wg = {"1": {"name": "A", "tier": 10}}
        fallback = {"29985": {"name": "SPHT", "tier": 10, "class": "重坦", "nation": "美国",
                              "premium": False, "alphaDamage": 400}}
        merged, fallback_ids = ut.merge_fallback(wg, fallback)
        self.assertIn("29985", merged)
        self.assertIn("29985", fallback_ids)
        self.assertEqual(merged["29985"]["alphaDamage"], 400)
        self.assertNotIn("premium", merged["29985"])  # 不消费字段不进入输出

    def test_wg_overrides_fallback(self):
        wg = {"29985": {"name": "SPHT", "tier": 10, "alphaDamage": 999}}
        fallback = {"29985": {"name": "SPHT", "tier": 10, "alphaDamage": 400}}
        merged, fallback_ids = ut.merge_fallback(wg, fallback)
        self.assertEqual(merged["29985"]["alphaDamage"], 999)  # WG 优先
        self.assertNotIn("29985", fallback_ids)

    def test_fallback_respects_min_tier(self):
        wg = {"1": {"name": "A", "tier": 10}}
        fallback = {"29985": {"name": "SPHT", "tier": 10, "class": "重坦", "nation": "美国"},
                    "257": {"name": "SU-85", "tier": 5, "class": "坦克歼击车", "nation": "苏联"}}
        merged, _ = ut.merge_fallback(wg, fallback)
        filtered = ut.filter_by_min_tier(merged, 7)
        self.assertIn("29985", filtered)
        self.assertNotIn("257", filtered)  # 5 级兜底条目同样被 min-tier 过滤

    def test_fallback_knowledge_preserved(self):
        old = {"29985": {"extraKnowledge": "SPHT 个人知识点"}}
        vehicles = {"1": {"name": "A", "tier": 10}}
        fallback = {"29985": {"name": "SPHT", "tier": 10, "class": "重坦", "nation": "美国"}}
        data = ut.transform(vehicles, "first", old)
        data, _ = ut.merge_fallback(data, fallback)
        data = ut.merge_extra_knowledge(data, old)
        self.assertEqual(data["29985"]["extraKnowledge"], "SPHT 个人知识点")


if __name__ == "__main__":
    unittest.main()
