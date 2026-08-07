# -*- coding: utf-8 -*-
"""update_tankopedia.py 单元测试（标准库 unittest，无网络依赖）。"""

import json
import os
import struct
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import update_tankopedia as ut


# ---- 最小 protobuf 编码器（用于构造 pb fixture） ----

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


def gun(gun_id, shells, clip=False):
    out = f_varint(4, gun_id)
    # GunDefinition oneof：field 1 = regular，field 2 = auto_loader（弹夹）
    out += f_bytes(2 if clip else 1, b"")
    for s in shells:
        out += f_bytes(10, s)
    return out


def turret(turret_hp, *gun_msgs, traverse=42.0, tier=10):
    out = f_varint(2, turret_hp) + f_varint(7, tier) + f_float(4, float(traverse))
    for gun_msg in gun_msgs:
        out += f_bytes(9, gun_msg)
    return out


def tank_data(tank_id, tier, tank_class, hull_hp, turret_msg, name="T-34",
              nation="ussr", speed_fwd=56, speed_bwd=20, weight=10000,
              engine_power=400, engine_tier=10, track_traverse=46.0, track_tier=10):
    td = b""
    td += f_varint(16, tier)
    td += f_varint(17, tank_class)
    td += f_varint(10, hull_hp)
    td += f_bytes(11, nation.encode())
    td += f_bytes(12, i18n([("en", name), ("ru", "тест")]))
    td += f_bytes(20, turret_msg)
    td += f_bytes(21, f_varint(4, engine_tier) + f_varint(6, engine_power))
    td += f_bytes(22, f_varint(2, track_tier) + f_float(5, float(track_traverse)))
    td += f_float(25, float(speed_fwd))
    td += f_float(26, float(speed_bwd))
    td += f_varint(31, weight)
    entry = f_varint(1, tank_id) + f_bytes(2, td)
    return f_bytes(1, entry)


def root(*tanks):
    return b"".join(tanks)


# ---- consumables.pb / provisions.pb fixture ----

def filter_tiers(lo, hi):
    inner = f_varint(1, lo) + f_varint(2, hi)
    return f_bytes(1, inner)


def filter_ids(ids):
    inner = b"".join(f_varint(1, i) for i in ids)
    return f_bytes(2, inner)


def filter_categories(categories):
    inner = b"".join(f_varint(1, c) for c in categories)
    return f_bytes(3, inner)


def filter_nations(nations):
    inner = b"".join(f_bytes(1, n.encode()) for n in nations)
    return f_bytes(4, inner)


def item_def(item_id, name, include=None, exclude=None):
    """Consumable/Provision map 条目。include/exclude=[(filter_bytes, ...)]。"""
    msg = f_bytes(2, i18n([("en", name)]))
    for flt in include or []:
        msg += f_bytes(6, flt)
    for flt in exclude or []:
        msg += f_bytes(7, flt)
    return f_bytes(1, f_varint(1, item_id) + f_bytes(2, msg))


def item_root(*items):
    return b"".join(items)


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


class KnowledgePreservationTest(unittest.TestCase):
    def test_old_extra_info_preserved(self):
        old = {"1": {"extraKnowledge": "点灯位"}, "2": {"extraInfo": "炮塔弱点"}}
        new = {"1": {"name": "A"}, "2": {"name": "B"}, "3": {"name": "C"}}
        merged = ut.merge_extra_info(new, old)
        self.assertEqual(merged["1"]["extraInfo"], "点灯位")
        self.assertEqual(merged["2"]["extraInfo"], "炮塔弱点")
        self.assertEqual(merged["3"]["extraInfo"], "")
        self.assertEqual(merged["1"]["priority"], 0)

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


class MinTierTest(unittest.TestCase):
    def test_min_tier_filters(self):
        data = {"1": {"tier": 5}, "2": {"tier": 7}, "3": {"tier": 10}}
        self.assertEqual(set(ut.filter_by_min_tier(data, 7)), {"2", "3"})
        self.assertEqual(set(ut.filter_by_min_tier(data, 1)), set(data))


class ParseTanksTest(unittest.TestCase):
    def test_extracts_full_vehicle(self):
        # T-34 形状：车体 496 + 炮塔 124 = 620；76mm：AP 140/85 + HEAT 120/115
        pb = root(tank_data(
            1, 5, 1, 496, turret(124,
                gun(100, [shell("ap", 140, 85), shell("hc_premium", 120, 115)])),
            name="T-34", nation="ussr", speed_fwd=56, speed_bwd=20,
            weight=10000, engine_power=400, track_traverse=46.0,
        ))
        vehicles = ut.parse_tanks(pb)
        v = vehicles["1"]
        self.assertEqual(v["name"], "T-34")
        self.assertEqual(v["id"], 1)
        self.assertEqual(v["tier"], 5)
        self.assertEqual(v["class"], "Medium tank")
        self.assertEqual(v["nation"], "USSR")
        self.assertEqual(v["hp"], 620)
        self.assertEqual(v["forwardSpeed"], 56)
        self.assertEqual(v["reverseSpeed"], 20)
        self.assertEqual(v["turretRotationSpeed"], 42.0)
        self.assertEqual(v["hullRotationSpeed"], 46.0)
        self.assertEqual(v["powerToWeightRatio"], 40.0)  # 400 hp / 10 t
        self.assertEqual(v["guns"][0]["gunId"], 100)
        self.assertTrue(v["guns"][0]["isDefault"])
        self.assertEqual(v["guns"][0]["alphaDamage"], 140)
        self.assertEqual(v["guns"][0]["shells"], [
            {"type": "ap", "damage": 140, "penetration": 85},
            {"type": "heat", "damage": 120, "penetration": 115},
        ])

    def test_tier10_multi_gun_goes_into_guns_array(self):
        # E 100 形状：顶配炮塔两把炮 -> vehicle 单条记录 + guns 数组两条
        pb = root(tank_data(
            9489, 10, 2, 2070,
            turret(680,
                gun(269329, [shell("ap", 460, 256), shell("ap_cr_premium", 390, 311), shell("he", 600, 65)]),
                gun(269073, [shell("ap", 645, 254), shell("hc_premium", 570, 334), shell("he", 990, 85)])),
            name="E 100", nation="germany",
        ))
        vehicles = ut.parse_tanks(pb)
        self.assertEqual(set(vehicles.keys()), {"9489"})
        v = vehicles["9489"]
        self.assertEqual(len(v["guns"]), 2)
        self.assertEqual(v["guns"][0]["gunId"], 269329)
        self.assertTrue(v["guns"][0]["isDefault"])
        self.assertEqual(v["guns"][0]["alphaDamage"], 460)
        self.assertEqual(v["guns"][1]["gunId"], 269073)
        self.assertFalse(v["guns"][1]["isDefault"])
        self.assertEqual(v["guns"][1]["alphaDamage"], 645)

    def test_clip_flag_on_autoloader(self):
        pb = root(tank_data(
            3649, 10, 1, 1700, turret(500,
                gun(25409, [shell("ap", 250, 238)], clip=True)),
            name="B-C 25 t", nation="france",
        ))
        v = ut.parse_tanks(pb)["3649"]
        self.assertTrue(v["guns"][0]["clip"])

    def test_missing_gun_yields_empty_guns_but_hp(self):
        turret_no_gun = f_varint(2, 600) + f_varint(7, 10)
        pb = root(f_bytes(1,
            f_varint(1, 9) + f_bytes(2,
                f_varint(16, 10) + f_varint(17, 2) + f_varint(10, 2000) +
                f_bytes(11, b"germany") + f_bytes(12, i18n([("en", "E 100")])) +
                f_bytes(20, turret_no_gun))))
        v = ut.parse_tanks(pb)["9"]
        self.assertEqual(v["hp"], 2600)
        self.assertEqual(v["guns"], [])


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


class MainPathTest(unittest.TestCase):
    def test_existing_output_different_paths_and_knowledge_preserved(self):
        tanks_pb = root(tank_data(
            1, 10, 2, 2070, turret(580,
                gun(500, [shell("ap", 420, 258), shell("hc_premium", 360, 340), shell("he", 500, 68)])),
            name="IS-4", nation="ussr",
        ))
        provisions_pb = item_root(item_def(0, "Field Rations", include=[filter_nations(["other"])]))
        consumables_pb = item_root(item_def(1, "Automatic Fire Extinguisher"))

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
            raise AssertionError("unexpected url: " + url)

        with tempfile.TemporaryDirectory() as tmp:
            old_path = os.path.join(tmp, "old.json")
            new_path = os.path.join(tmp, "new.json")
            with open(old_path, "w", encoding="utf-8") as f:
                json.dump({"meta": {}, "vehicles": [
                    {"id": 1, "extraInfo": "保留我"},
                ]}, f)
            with open(old_path, "rb") as f:
                old_bytes_before = f.read()

            with mock.patch.object(ut.urllib.request, "urlopen", side_effect=fake_urlopen):
                rc = ut.main(["--existing", old_path, "--output", new_path, "--min-tier", "1"])

            self.assertEqual(rc, 0)
            with open(old_path, "rb") as f:
                self.assertEqual(f.read(), old_bytes_before)  # 旧文件未被修改
            with open(new_path, encoding="utf-8") as f:
                payload = json.load(f)
            self.assertEqual(payload["meta"]["count"], 1)
            vehicle = payload["vehicles"][0]
            self.assertEqual(vehicle["id"], 1)
            self.assertEqual(vehicle["extraInfo"], "保留我")
            self.assertEqual(vehicle["hp"], 2650)
            self.assertEqual(vehicle["guns"][0]["shells"][0]["penetration"], 258)
            self.assertEqual(vehicle["priority"], 0)


if __name__ == "__main__":
    unittest.main()
