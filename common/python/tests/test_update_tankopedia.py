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


def gun(gun_id, shells, clip=False, tier=10):
    out = f_varint(4, gun_id)
    out += f_varint(9, tier)
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
              engine_power=400, engine_tier=10, track_traverse=46.0, track_tier=10,
              equipment_preset="defaultPreset"):
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
    td += f_bytes(30, equipment_preset.encode())
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


# ---- equipment.pb fixture ----

def equipment_preset(name, slots):
    slots_msg = b"".join(f_bytes(1, f_varint(1, left) + f_varint(2, right))
                         for left, right in slots)
    return f_bytes(1, f_bytes(1, name.encode()) + f_bytes(2, slots_msg))


def equipment_item(equipment_id, name):
    return f_bytes(2, f_varint(1, equipment_id) + f_bytes(2, i18n([("en", name)])))


def equipment_root(*entries):
    return b"".join(entries)


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
        self.assertEqual(v["alphaDamage"], 140)
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
        # 10 级多终局炮：不标默认、不输出权威 alphaDamage（回放无可靠实际炮）
        self.assertFalse(v["guns"][0]["isDefault"])
        self.assertFalse(v["guns"][1]["isDefault"])
        self.assertNotIn("alphaDamage", v)
        self.assertEqual(v["guns"][0]["alphaDamage"], 460)
        self.assertEqual(v["guns"][1]["gunId"], 269073)
        self.assertEqual(v["guns"][1]["alphaDamage"], 645)

    def test_tier7_9_top_gun_selected_as_default(self):
        # T-34-2 回归：5 把炮（200/200/280/400/280），顶配炮塔最高 tier=8，
        # 同 tier 取最高 alpha -> 122mm 400 为默认，不能把数组第一把 200 当默认
        pb = root(tank_data(
            1585, 8, 1, 1300,
            turret(360,
                   gun(817, [shell("ap", 200, 100)], tier=6),
                   gun(1073, [shell("ap", 200, 100)], tier=6),
                   gun(1329, [shell("ap", 280, 100)], tier=7),
                   gun(2353, [shell("ap", 400, 100)], tier=8),
                   gun(2609, [shell("ap", 280, 100)], tier=8)),
            name="T-34-2", nation="china",
        ))
        v = ut.parse_tanks(pb)["1585"]
        self.assertEqual(v["alphaDamage"], 400)
        defaults = [g["gunId"] for g in v["guns"] if g["isDefault"]]
        self.assertEqual(defaults, [2353])
        self.assertFalse(v["guns"][0]["isDefault"])  # 第一把 200 不再是默认

    def test_tier10_single_gun_still_authoritative(self):
        # SPHT 形状：10 级单炮 -> 正常输出 alphaDamage
        pb = root(tank_data(
            29985, 10, 2, 3400, turret(1000,
                                       gun(272929, [shell("ap", 400, 252)])),
            name="SPHT", nation="usa",
        ))
        v = ut.parse_tanks(pb)["29985"]
        self.assertEqual(v["alphaDamage"], 400)
        self.assertTrue(v["guns"][0]["isDefault"])

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


class EquipmentTest(unittest.TestCase):
    def test_allowed_equipment_from_preset(self):
        # VK 72.01 形状：特殊预设带 俯角/履带齿 专属装备（122/123）
        tanks_pb = root(tank_data(
            58641, 10, 2, 2100, turret(600,
                                       gun(100, [shell("ap", 460, 250)])),
            name="VK 72.01", nation="germany",
            equipment_preset="DrumGunPitchLimitsPreset",
        ))
        equipment_pb = equipment_root(
            equipment_preset("DrumGunPitchLimitsPreset", [(102, 103), (122, 123)]),
            equipment_preset("defaultPreset", [(100, 103)]),
            equipment_item(100, "Gun Rammer"),
            equipment_item(102, "Improved Ventilation"),
            equipment_item(103, "Calibrated Shells"),
            equipment_item(122, "Improved Vertical Stabilizer"),
            equipment_item(123, "Improved Suspension"),
        )
        presets, _ = ut.parse_equipment_defs(equipment_pb)
        self.assertEqual(presets["DrumGunPitchLimitsPreset"], {102, 103, 122, 123})

        with tempfile.TemporaryDirectory() as tmp:
            catalog = os.path.join(tmp, "catalog")
            os.makedirs(catalog)
            with open(os.path.join(catalog, "equipment.json"), "w", encoding="utf-8") as f:
                json.dump({"items": [
                    {"id": 100, "code": "GUN_RAMMER"},
                    {"id": 102, "code": "IMPROVED_VENTILATION"},
                    {"id": 103, "code": "CALIBRATED_SHELLS"},
                    {"id": 122, "code": "IMPROVED_VERTICAL_STABILIZER"},
                    {"id": 123, "code": "IMPROVED_SUSPENSION"},
                ]}, f)
            with mock.patch.object(ut, "CATALOG_DIR", catalog):
                equipment_map = ut.load_equipment_catalog()

        vehicles = ut.apply_equipment(ut.parse_tanks(tanks_pb), presets, equipment_map)
        vehicle = vehicles["58641"]
        self.assertEqual(vehicle["allowedEquipment"], [
            "CALIBRATED_SHELLS", "IMPROVED_SUSPENSION",
            "IMPROVED_VENTILATION", "IMPROVED_VERTICAL_STABILIZER",
        ])
        out = ut.vehicle_output(vehicle)
        self.assertNotIn("_equipmentPreset", out)
        self.assertNotIn("priority", out)

    def test_unknown_preset_yields_empty_equipment(self):
        tanks_pb = root(tank_data(
            9489, 10, 2, 2070, turret(680,
                                      gun(269329, [shell("ap", 460, 256)])),
            name="E 100", nation="germany", equipment_preset="no-such-preset",
        ))
        vehicles = ut.apply_equipment(ut.parse_tanks(tanks_pb), {}, {})
        self.assertEqual(vehicles["9489"]["allowedEquipment"], [])


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
            ut.validate_integrity({"1": self.vehicle(1, tier=6)}, {})

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


class MainPathTest(unittest.TestCase):
    def test_existing_output_different_paths_and_knowledge_preserved(self):
        tanks_pb = root(tank_data(
            1, 10, 2, 2070, turret(580,
                                   gun(500,
                                       [shell("ap", 420, 258), shell("hc_premium", 360, 340), shell("he", 500, 68)])),
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
                self.assertEqual(f.read(), old_bytes_before)  # 旧文件未被修改
            self.assertEqual(
                sorted(os.listdir(new_dir)),
                sorted(ut.TIER_FILES.values()),
            )
            with open(os.path.join(new_dir, "tankopedia-tier10.json"), encoding="utf-8") as f:
                payload = json.load(f)
            self.assertEqual(payload["meta"]["count"], 1)
            self.assertEqual(payload["meta"]["tier"], 10)
            vehicle = payload["vehicles"][0]
            self.assertEqual(vehicle["id"], 1)
            self.assertEqual(vehicle["extraInfo"], "保留我")
            self.assertEqual(vehicle["hp"], 2650)
            self.assertEqual(vehicle["alphaDamage"], 420)  # 单炮车权威炮伤
            self.assertEqual(vehicle["guns"][0]["shells"][0]["penetration"], 258)
            self.assertEqual(vehicle["allowedEquipment"], [
                "CALIBRATED_SHELLS", "GUN_RAMMER",
                "IMPROVED_SUSPENSION", "IMPROVED_VERTICAL_STABILIZER",
            ])

    def test_main_filters_out_of_scope_tiers_before_integrity_gate(self):
        # 回归：真实 tanks.pb 含 1-10 级车辆，业务范围过滤必须在 validate_integrity 之前，
        # 否则 tier 5 T-34 会触发 TANKOPEDIA_TIER_OUT_OF_RANGE 导致 workflow 失败。
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
            # 旧 tier8 数据只有 T-34-2，带 extraInfo
            with open(os.path.join(old_dir, "tankopedia-tier8.json"), "w", encoding="utf-8") as f:
                json.dump({"meta": {}, "vehicles": [
                    {"id": 1585, "extraInfo": "保留我"},
                ]}, f)

            with mock.patch.object(ut.urllib.request, "urlopen", side_effect=fake_urlopen):
                rc = ut.main(["--existing-dir", old_dir, "--output-dir", new_dir])

            self.assertEqual(rc, 0)
            # 4 个 tier 文件正常生成
            self.assertEqual(
                sorted(os.listdir(new_dir)),
                sorted(ut.TIER_FILES.values()),
            )
            files = {}
            for name in ut.TIER_FILES.values():
                with open(os.path.join(new_dir, name), encoding="utf-8") as f:
                    files[name] = json.load(f)
            all_ids = {v["id"] for payload in files.values() for v in payload["vehicles"]}
            # tier 5 T-34 不进入任何最终 JSON，且不触发 TANKOPEDIA_TIER_OUT_OF_RANGE
            self.assertNotIn(1, all_ids)
            # tier 8 T-34-2 正常生成：alphaDamage=400、extraInfo 保留
            tier8_vehicles = files["tankopedia-tier8.json"]["vehicles"]
            t82 = next(v for v in tier8_vehicles if v["id"] == 1585)
            self.assertEqual(t82["alphaDamage"], 400)
            self.assertEqual(t82["extraInfo"], "保留我")
            self.assertEqual(len(t82["guns"]), 5)
            # tier 10 SPHT 单炮仍为 400
            spht = next(v for v in files["tankopedia-tier10.json"]["vehicles"] if v["id"] == 29985)
            self.assertEqual(spht["alphaDamage"], 400)
            # 无 7/9 级车辆时对应文件存在且为空
            self.assertEqual(files["tankopedia-tier7.json"]["meta"]["count"], 0)
            self.assertEqual(files["tankopedia-tier9.json"]["meta"]["count"], 0)


if __name__ == "__main__":
    unittest.main()
