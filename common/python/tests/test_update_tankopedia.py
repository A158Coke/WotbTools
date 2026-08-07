# -*- coding: utf-8 -*-
"""update_tankopedia.py 单元测试（标准库 unittest，无网络依赖）。"""

import io
import json
import os
import struct
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import update_tankopedia as ut


# ---- 最小 protobuf 编码器（用于构造 tanks.pb fixture） ----

def encode_varint(value):
    out = bytearray()
    while True:
        b = value & 0x7F
        value >>= 7
        if value:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def key(field, wt):
    return encode_varint((field << 3) | wt)


def f_bytes(field, data):
    return key(field, 2) + encode_varint(len(data)) + bytes(data)


def f_varint(field, value):
    return key(field, 0) + encode_varint(value)


def f_float(field, value):
    return key(field, 5) + struct.pack("<f", value)


def i18n(entries):
    """I18nString: entries=[(locale, value)]"""
    out = b""
    for loc, val in entries:
        out += f_bytes(1, f_bytes(1, loc.encode()) + f_bytes(2, val.encode()))
    return out


def shell(shell_type, damage, pen):
    pen_msg = f_float(1, float(pen)) + f_float(2, float(pen))
    return (f_bytes(7, shell_type.encode()) + f_varint(4, damage) + f_bytes(8, pen_msg))


def gun(gun_id, shells):
    out = f_varint(4, gun_id)
    for s in shells:
        out += f_bytes(10, s)
    return out


def turret(turret_hp, *gun_msgs):
    out = f_varint(2, turret_hp)
    for gun_msg in gun_msgs:
        out += f_bytes(9, gun_msg)
    return out


def tank_data(tank_id, tier, tank_class, hull_hp, turret_msg,
              name="T-34", nation="ussr"):
    td = b""
    td += f_varint(16, tier)
    td += f_varint(17, tank_class)
    td += f_varint(10, hull_hp)
    td += f_bytes(11, nation.encode())
    td += f_bytes(12, i18n([("en", name), ("ru", "тест")]))
    td += f_bytes(20, turret_msg)
    entry = f_varint(1, tank_id) + f_bytes(2, td)
    return f_bytes(1, entry)


def root(*tanks):
    return b"".join(tanks)


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

    def test_removed_vehicle_disappears(self):
        old = {"1": {"extraKnowledge": "知识"}, "2": {"extraKnowledge": "旧车知识"}}
        new = {"1": {"name": "A"}}
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
        del merged["1"]["extraKnowledge"]
        ok, _, _ = ut.verify_knowledge_preservation(old, merged)
        self.assertFalse(ok)

    def test_merge_fails_when_entry_not_preservable(self):
        old = {"1": {"extraKnowledge": "知识"}}
        new = {"1": "not-a-dict"}
        with self.assertRaisesRegex(RuntimeError, "TANKOPEDIA_KNOWLEDGE_LOST"):
            ut.merge_extra_knowledge(new, old)


class MinTierTest(unittest.TestCase):
    def test_min_tier_filters(self):
        data = {"1": {"tier": 5}, "2": {"tier": 7}, "3": {"tier": 10}}
        self.assertEqual(set(ut.filter_by_min_tier(data, 7)), {"2", "3"})
        self.assertEqual(set(ut.filter_by_min_tier(data, 1)), set(data))


class ParseTanksTest(unittest.TestCase):
    def test_extracts_default_profile(self):
        # T-34 形状：车体 496 + 炮塔 124 = 620；76mm L-11：AP 140/85 + HEAT 120/115
        pb = root(tank_data(
            1, 5, 1, 496, turret(124,
                gun(100, [shell("ap", 140, 85), shell("hc_premium", 120, 115)])),
            name="T-34",
        ))
        data = ut.parse_tanks(pb)
        entry = data["1"]
        self.assertEqual(entry["name"], "T-34")
        self.assertEqual(entry["tier"], 5)
        self.assertEqual(entry["class"], "中坦")
        self.assertEqual(entry["nation"], "苏联")
        self.assertEqual(entry["hp"], 620)
        self.assertEqual(entry["gunId"], 100)
        self.assertTrue(entry["isDefault"])
        self.assertEqual(entry["alphaDamage"], 140)
        self.assertEqual(entry["shells"], [
            {"type": "ap", "damage": 140, "penetration": 85},
            {"type": "heat", "damage": 120, "penetration": 115},
        ])

    def test_uses_default_turret_only(self):
        # 两个炮塔：A 是最高等级（tier 10、hp 500），B 等级更低但 hp 更高（900）——
        # 顶配炮塔按「最高 tier，平局取 hp」取 A
        turret_a = f_varint(7, 10) + turret(500, gun(200, [
            shell("ap", 225, 173), shell("hc_premium", 200, 250), shell("he", 270, 45)]))
        turret_b = f_varint(7, 9) + turret(900, gun(201, [shell("he", 780, 75)]))
        td = b""
        td += f_varint(16, 8)
        td += f_varint(17, 0)
        td += f_varint(10, 1100)
        td += f_bytes(11, b"usa")
        td += f_bytes(12, i18n([("en", "T49")]))
        td += f_bytes(20, turret_a)
        td += f_bytes(20, turret_b)
        pb = root(f_bytes(1, f_varint(1, 2) + f_bytes(2, td)))
        data = ut.parse_tanks(pb)
        entry = data["2"]
        self.assertEqual(entry["hp"], 1100 + 500)  # 最高等级炮塔 A
        self.assertEqual(entry["shells"][0], {"type": "ap", "damage": 225, "penetration": 173})
        self.assertEqual(len(entry["shells"]), 3)

    def test_type_normalization(self):
        cases = {
            "ap": "ap", "ap_premium": "ap",
            "ap_cr": "apcr", "ap_cr_premium": "apcr",
            "hc": "heat", "hc_premium": "heat", "atgm_heat": "heat",
            "he": "he", "he_premium": "he",
        }
        for raw, expected in cases.items():
            pb = root(tank_data(
                3, 10, 2, 2000, turret(600,
                    gun(300, [shell(raw, 400, 258)])),
                name="X",
            ))
            entry = ut.parse_tanks(pb)["3"]
            self.assertEqual(entry["shells"][0]["type"], expected, raw)

    def test_tier10_multi_gun_split(self):
        # E 100 形状：顶配炮塔两把炮，按炮拆成主记录 + 变体记录
        pb = root(tank_data(
            9489, 10, 2, 2070,
            turret(680,
                gun(269329, [shell("ap", 460, 256), shell("ap_cr_premium", 390, 311), shell("he", 600, 65)]),
                gun(269073, [shell("ap", 645, 254), shell("hc_premium", 570, 334), shell("he", 990, 85)])),
            name="E 100",
        ))
        data = ut.parse_tanks(pb)
        self.assertIn("9489", data)
        self.assertIn("9489_269073", data)
        self.assertNotIn("9489_269329", data)  # 第一把炮就是主记录
        main = data["9489"]
        variant = data["9489_269073"]
        self.assertEqual(main["gunId"], 269329)
        self.assertTrue(main["isDefault"])
        self.assertEqual(main["alphaDamage"], 460)
        self.assertEqual(main["shells"][0], {"type": "ap", "damage": 460, "penetration": 256})
        self.assertEqual(variant["gunId"], 269073)
        self.assertFalse(variant["isDefault"])
        self.assertEqual(variant["alphaDamage"], 645)
        self.assertEqual(variant["shells"][2], {"type": "he", "damage": 990, "penetration": 85})
        # 名称/车种/等级/国家/hp 与主记录一致
        for key in ("name", "tier", "class", "nation", "hp"):
            self.assertEqual(main[key], variant[key])

    def test_tier9_multi_gun_not_split(self):
        # 9 级车即使顶配炮塔有多把炮也不拆分，只保留第一把
        pb = root(tank_data(
            4, 9, 2, 1900,
            turret(600,
                gun(400, [shell("ap", 310, 226), shell("he", 320, 60)]),
                gun(401, [shell("ap", 460, 220), shell("he", 480, 65)])),
            name="Tiger II",
        ))
        data = ut.parse_tanks(pb)
        self.assertEqual(set(data.keys()), {"4"})
        self.assertEqual(data["4"]["gunId"], 400)
        self.assertEqual(data["4"]["alphaDamage"], 310)

    def test_missing_gun_yields_no_shells_but_hp(self):
        turret_no_gun = f_varint(2, 600)  # 没有 field9（炮）
        pb = root(f_bytes(1,
            f_varint(1, 9) + f_bytes(2,
                f_varint(16, 10) + f_varint(17, 2) + f_varint(10, 2000) +
                f_bytes(11, b"germany") + f_bytes(12, i18n([("en", "E 100")])) +
                f_bytes(20, turret_no_gun))))
        entry = ut.parse_tanks(pb)["9"]
        self.assertEqual(entry["hp"], 2600)
        self.assertNotIn("shells", entry)
        self.assertNotIn("alphaDamage", entry)


class VariantKnowledgeTest(unittest.TestCase):
    def test_knowledge_applies_to_all_variants(self):
        old = {"9489": {"extraKnowledge": "首上可靠"}}
        pb = root(tank_data(
            9489, 10, 2, 2070,
            turret(680,
                gun(269329, [shell("ap", 460, 256), shell("he", 600, 65)]),
                gun(269073, [shell("ap", 645, 254), shell("he", 990, 85)])),
            name="E 100",
        ))
        new = ut.parse_tanks(pb)
        merged = ut.merge_extra_knowledge(new, old)
        self.assertEqual(merged["9489"]["extraKnowledge"], "首上可靠")
        self.assertEqual(merged["9489_269073"]["extraKnowledge"], "首上可靠")
        ok, old_count, preserved = ut.verify_knowledge_preservation(old, merged)
        self.assertTrue(ok)
        self.assertEqual(old_count, 1)
        self.assertEqual(preserved, 2)  # 主记录 + 变体都保留

    def test_knowledge_missing_on_variant_detected(self):
        old = {"9489": {"extraKnowledge": "首上可靠"}}
        merged = {
            "9489": {"extraKnowledge": "首上可靠"},
            "9489_269073": {},
        }
        ok, _, _ = ut.verify_knowledge_preservation(old, merged)
        self.assertFalse(ok)


class MainPathTest(unittest.TestCase):
    def test_existing_output_different_paths_and_knowledge_preserved(self):
        pb = root(tank_data(
            1, 10, 2, 2070, turret(580,
                gun(500, [shell("ap", 420, 258), shell("hc_premium", 360, 340), shell("he", 500, 68)])),
            name="IS-4",
        ))

        class FakeResp:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def read(self):
                return pb

        with tempfile.TemporaryDirectory() as tmp:
            old_path = os.path.join(tmp, "old.json")
            new_path = os.path.join(tmp, "new.json")
            with open(old_path, "w", encoding="utf-8") as f:
                json.dump({"meta": {}, "data": {"1": {"extraKnowledge": "保留我"}}}, f)
            with open(old_path, "rb") as f:
                old_bytes_before = f.read()

            with mock.patch.object(ut.urllib.request, "urlopen", return_value=FakeResp()):
                rc = ut.main(["--existing", old_path, "--output", new_path, "--min-tier", "1"])

            self.assertEqual(rc, 0)
            with open(old_path, "rb") as f:
                self.assertEqual(f.read(), old_bytes_before)  # 旧文件未被修改
            with open(new_path, encoding="utf-8") as f:
                payload = json.load(f)
            self.assertEqual(payload["data"]["1"]["extraKnowledge"], "保留我")
            self.assertEqual(payload["data"]["1"]["hp"], 2650)
            self.assertEqual(payload["data"]["1"]["shells"][0]["penetration"], 258)


if __name__ == "__main__":
    unittest.main()
