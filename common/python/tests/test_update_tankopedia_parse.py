# -*- coding: utf-8 -*-
"""Focused Tankopedia regression tests (stdlib unittest, no live network)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import update_tankopedia as ut
from _tankopedia_test_fixtures import (
    f_bytes, f_varint, i18n, shell, gun, turret, tank_data, root,
)

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
