#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 blitzkit（游戏客户端数据）生成车辆库 common/tankopedia-tier{7,8,9,10}.json。

用法：
    python update_tankopedia.py [--existing-dir common] [--output-dir common]

输出为按等级拆分的 4 个文件（meta + vehicles 数组）：
    common/tankopedia-tier7.json   // 7 级车辆
    common/tankopedia-tier8.json   // 8 级车辆
    common/tankopedia-tier9.json   // 9 级车辆
    common/tankopedia-tier10.json  // 10 级车辆

输出格式（全部字段与 value 均为英文/数字）：
    {
      "meta": { "source", "min_tier", "generated_at", "count" },
      "vehicles": [
        {
          "name": "Type 59",            // 英文名（i18n_en）
          "id": 49,                     // tank_id（blitzkit 与游戏/WG 同空间）
          "tier": 8,
          "class": "Medium tank",       // Light/Medium/Heavy/Tank destroyer
          "nation": "China",            // 英文国家
          "hp": 1370,                   // 车体 + 顶配炮塔
          "forwardSpeed": 56,           // km/h（TankDefinition.speed_forwards）
          "reverseSpeed": 20,           // km/h（speed_backwards）
          "turretRotationSpeed": 42.0,  // deg/s（顶配炮塔 traverse）
          "hullRotationSpeed": 46.0,    // deg/s（顶配履带 traverse）
          "powerToWeightRatio": 31.6,   // hp/t（顶配引擎功率 / 车重）
          "guns": [
            { "gunId", "isDefault", "alphaDamage", "shells": [{type,damage,penetration}] }
          ],                            // 顶配炮塔上的全部炮（含 7-9 级多炮如 T-34-2 的 5 把）
                                        // isDefault = 权威默认炮：
                                        //   7-9 级 = 顶配炮（最高 tier，同 tier 取最高 alpha）
                                        //   10 级多炮车 = 全部 false（回放无可靠实际炮，不伪装）
          "allowedProvision": [...],    // catalog 逻辑物资 id（SMALL_FOOD 等）
          "allowedConsumables": [...],  // catalog 消耗品 code（AUTOMATIC_FIRE_EXTINGUISHER 等）
          "allowedEquipment": [...],    // catalog 装备 code（含 VK 72.01 俯角 / 履带齿等专属装备）
          "alphaDamage": 420,           // 仅唯一权威时输出：单炮车 / 7-9 顶配炮；
                                        // 10 级多炮车省略（避免把不确定炮伤伪装成权威事实）
          "extraInfo": ""               // 手工知识点（原 extraKnowledge，按 tank_id 保留合并）
        }
      ]
    }

设计约定：
- 数据源为 blitzkit（tanks.pb + consumables.pb + provisions.pb + equipment.pb，游戏客户端直出，
  含最新车辆如 11.19 的 SPHT / AC Atlas；WG 百科滞后游戏版本，故不依赖 WG API）。
- 每辆车一条记录，guns 数组含顶配炮塔上的全部炮；isDefault 标记权威默认炮：
  - 7-9 级：顶配炮 = 最高 tier，同 tier 取最高 alpha（已用 origin/main 全量 454/457 验证；
    T-34-2 取 122mm 400，不能用数组顺序猜）。
  - 10 级多炮车：存在多个合法终局炮，回放无可靠实际 gunId，全部 isDefault=false、
    不输出 vehicle 级 alphaDamage，运行时 AI 结构化事实省略炮伤（不输出虚假唯一炮伤）。
  - 10 级单炮车：正常输出 alphaDamage。
- 每车可用物资：由 blitzkit 的 include/exclude 过滤器（tier/ids/categories/nations）
  判定，再映射到 common/wotb-item-catalog-json 的逻辑 id / code；
  catalog 未收录的道具（多为活动/娱乐模式专属）不输出。
- extraInfo 按 tank_id 保留合并；仍存在车辆的知识点丢失会直接失败。
- 只输出 7-10 级四个等级文件（业务范围：个人随机 7-10、团队联赛 10 级）。
- 脚本无第三方依赖（仅标准库 urllib / struct / json）。
"""

import argparse
import json
import os
import struct
import sys
import urllib.request
from datetime import datetime, timezone

PB_URL = "https://assets.blitzkit.app/definitions/tanks.pb"
CONSUMABLES_URL = "https://assets.blitzkit.app/definitions/consumables.pb"
PROVISIONS_URL = "https://assets.blitzkit.app/definitions/provisions.pb"
EQUIPMENT_URL = "https://assets.blitzkit.app/definitions/equipment.pb"

REPO_COMMON_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "common",
)
TIER_FILES = {
    7: "tankopedia-tier7.json",
    8: "tankopedia-tier8.json",
    9: "tankopedia-tier9.json",
    10: "tankopedia-tier10.json",
}
MIN_TIER_COUNT_RATIO = 0.8
CATALOG_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "common",
    "wotb-item-catalog-json",
)

# ---- tanks.pb 字段号（TankDefinition） ----
FIELD_TANK_ID = 1
FIELD_TANK_DATA = 2
FIELD_TANK_HULL_HP = 10
FIELD_TANK_NATION = 11
FIELD_TANK_NAME = 12
FIELD_TANK_TIER = 16
FIELD_TANK_CLASS = 17
FIELD_TANK_TURRETS = 20
FIELD_TANK_ENGINES = 21
FIELD_TANK_TRACKS = 22
FIELD_TANK_SPEED_FORWARD = 25
FIELD_TANK_SPEED_BACKWARD = 26
FIELD_TANK_WEIGHT = 31
FIELD_TANK_EQUIPMENT_PRESET = 30

# ---- 炮塔 / 炮 / 引擎 / 履带 / 弹 ----
FIELD_TURRET_HP = 2
FIELD_TURRET_TRAVERSE = 4
FIELD_TURRET_TIER = 7
FIELD_TURRET_GUN = 9
FIELD_GUN_ID = 4
FIELD_GUN_TIER = 9
FIELD_GUN_SHELLS = 10
FIELD_ENGINE_TIER = 4
FIELD_ENGINE_POWER = 6
FIELD_TRACK_TIER = 2
FIELD_TRACK_TRAVERSE = 5
FIELD_SHELL_TYPE = 7
FIELD_SHELL_DAMAGE = 4
FIELD_SHELL_PEN = 8
FIELD_PEN_VALUE = 1

# ---- consumables.pb / provisions.pb（map 条目 + 过滤器） ----
FIELD_MAP_KEY = 1
FIELD_MAP_VALUE = 2
FIELD_ITEM_NAME = 2
FIELD_ITEM_INCLUDE = 6
FIELD_ITEM_EXCLUDE = 7
FILTER_TIERS = 1
FILTER_IDS = 2
FILTER_CATEGORIES = 3
FILTER_NATIONS = 4
FILTER_CATEGORY_CLIP = 0

CLASS_TO_EN = {
    0: "Light tank",
    1: "Medium tank",
    2: "Heavy tank",
    3: "Tank destroyer",
}

NATION_TO_EN = {
    "ussr": "USSR",
    "germany": "Germany",
    "usa": "USA",
    "china": "China",
    "france": "France",
    "uk": "UK",
    "japan": "Japan",
    "european": "European",
    "other": "Other",
}

# blitzkit 弹型字符串 -> 归一化类型
SHELL_TYPE_NORM = {
    "ap": "ap",
    "ap_premium": "ap",
    "ap_cr": "apcr",
    "ap_cr_premium": "apcr",
    "hc": "heat",
    "hc_premium": "heat",
    "atgm_heat": "heat",
    "he": "he",
    "he_premium": "he",
}


# ---- protobuf helpers（自包含，无第三方依赖） ----

def _read_varint(buf, i):
    shift = 0
    result = 0
    while True:
        b = buf[i]
        i += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            break
        shift += 7
    return result, i


def decode_protobuf(buf):
    """自包含 protobuf 解码器：返回 {field_number: [values]}。"""
    if not isinstance(buf, (bytes, bytearray)):
        return {}
    fields = {}
    i = 0
    n = len(buf)
    while i < n:
        try:
            tag, i = _read_varint(buf, i)
        except IndexError:
            break
        field = tag >> 3
        wt = tag & 7
        if field == 0:
            break
        try:
            if wt == 0:
                val, i = _read_varint(buf, i)
            elif wt == 1:
                val = struct.unpack("<Q", buf[i:i + 8])[0]
                i += 8
            elif wt == 5:
                val = struct.unpack("<I", buf[i:i + 4])[0]
                i += 4
            elif wt == 2:
                ln, i = _read_varint(buf, i)
                val = buf[i:i + ln]
                i += ln
            else:
                break
        except (IndexError, struct.error):
            break
        fields.setdefault(field, []).append(val)
    return fields


def as_str(raw):
    if isinstance(raw, str):
        return raw
    if not isinstance(raw, (bytes, bytearray)):
        return raw
    for enc in ("utf-8", "latin1"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.hex()


def as_int(raw, default=None):
    if isinstance(raw, int):
        return raw
    return default


def f1(fields, num, default=None):
    values = fields.get(num)
    if not values:
        return default
    return values[0]


def f32(x):
    try:
        return struct.unpack("<f", struct.pack("<I", x))[0]
    except (TypeError, struct.error):
        return None


def i18n_en(raw):
    """从 I18nString(map<string,string>) 取英文名，没有则取第一个。"""
    best = None
    for entry in decode_protobuf(raw).get(1, []):
        kv = decode_protobuf(entry)
        loc = as_str(f1(kv, 1, b""))
        val = as_str(f1(kv, 2, b""))
        if loc == "en":
            return val
        if best is None:
            best = val
    return best


def shell_entry(raw_shell):
    """解析单个 shell 消息 -> {type, damage, penetration}；无法解析返回 None。"""
    if not isinstance(raw_shell, (bytes, bytearray)):
        return None
    shell = decode_protobuf(raw_shell)
    shell_type = SHELL_TYPE_NORM.get(as_str(f1(shell, FIELD_SHELL_TYPE)))
    if not shell_type:
        return None
    damage = as_int(f1(shell, FIELD_SHELL_DAMAGE))
    if not damage:
        return None
    penetration = None
    pen_raw = f1(shell, FIELD_SHELL_PEN)
    if pen_raw:
        pen = f1(decode_protobuf(pen_raw), FIELD_PEN_VALUE)
        if pen is not None:
            penetration = int(round(f32(pen)))
    return {"type": shell_type, "damage": damage, "penetration": penetration}


# ---- tanks.pb -> vehicles ----

def top_turret(td):
    """取顶配炮塔：最高 tier（平局取 hp 高者），返回 (turret_fields, 总血量)。"""
    hull_hp = as_int(f1(td, FIELD_TANK_HULL_HP))
    best_turret = None  # (tier, hp, turret_fields)
    for raw_turret in td.get(FIELD_TANK_TURRETS, []):
        turret = decode_protobuf(raw_turret)
        turret_tier = as_int(f1(turret, FIELD_TURRET_TIER, 0), 0)
        turret_hp = as_int(f1(turret, FIELD_TURRET_HP))
        if (best_turret is None
                or turret_tier > best_turret[0]
                or (turret_tier == best_turret[0] and (turret_hp or 0) > (best_turret[1] or 0))):
            best_turret = (turret_tier, turret_hp, turret)
    total_hp = None
    if hull_hp and best_turret and best_turret[1]:
        total_hp = hull_hp + best_turret[1]
    return (best_turret[2] if best_turret else None), total_hp


def guns_of_turret(turret):
    """炮塔 field9 直接条目（游戏内炮列表，按序），返回 [{'gunId', 'tier', 'shells', 'clip'}]。

    clip = 该炮是弹夹/自动装填（oneof 2/3），用于 consumable 的 CLIP 类别过滤。
    tier = GunDefinition.field9（炮等级），用于挑选顶配炮。
    只读直接条目，避免把嵌套消息误判成炮；shells 为空或 gunId 缺失的条目跳过。
    """
    guns = []
    for raw_gun in turret.get(FIELD_TURRET_GUN, []):
        gun = decode_protobuf(raw_gun)
        gun_id = as_int(f1(gun, FIELD_GUN_ID))
        if not gun_id:
            continue
        shells = []
        for raw_shell in gun.get(FIELD_GUN_SHELLS, []):
            entry = shell_entry(raw_shell)
            if entry:
                shells.append(entry)
        if not shells:
            continue
        clip = any(f1(gun, field) is not None for field in (2, 3))
        tier = as_int(f1(gun, FIELD_GUN_TIER, 0), 0)
        guns.append({"gunId": gun_id, "tier": tier, "shells": shells, "clip": clip})
    return guns


def top_engine(td):
    """顶配引擎（最高 tier，平局取功率高者）-> power（hp，uint32）。"""
    best = None  # (tier, power)
    for raw_engine in td.get(FIELD_TANK_ENGINES, []):
        engine = decode_protobuf(raw_engine)
        tier = as_int(f1(engine, FIELD_ENGINE_TIER, 0), 0)
        power = as_int(f1(engine, FIELD_ENGINE_POWER))
        if not power:
            continue
        if best is None or tier > best[0] or (tier == best[0] and power > best[1]):
            best = (tier, power)
    return best[1] if best else None


def top_track_traverse(td):
    """顶配履带（最高 tier，平局取转速高者）-> traverse（deg/s）。"""
    best = None  # (tier, traverse)
    for raw_track in td.get(FIELD_TANK_TRACKS, []):
        track = decode_protobuf(raw_track)
        tier = as_int(f1(track, FIELD_TRACK_TIER, 0), 0)
        traverse = f32(f1(track, FIELD_TRACK_TRAVERSE))
        if traverse is None:
            continue
        if best is None or tier > best[0] or (tier == best[0] and traverse > best[1]):
            best = (tier, traverse)
    return best[1] if best else None


def parse_tanks(pb_bytes):
    """tanks.pb -> {tank_id: vehicle dict}（不含 extraInfo/物资/装备列表）。"""
    vehicles = {}
    for entry in decode_protobuf(pb_bytes).get(FIELD_TANK_ID, []):
        kv = decode_protobuf(entry)
        tank_id = as_int(f1(kv, FIELD_TANK_ID))
        if tank_id is None:
            continue
        td = decode_protobuf(f1(kv, FIELD_TANK_DATA, b""))
        if not td:
            continue
        nation = as_str(f1(td, FIELD_TANK_NATION, b""))
        turret, hp = top_turret(td)
        guns = guns_of_turret(turret) if turret else []
        tier = as_int(f1(td, FIELD_TANK_TIER))
        item = {
            "name": i18n_en(f1(td, FIELD_TANK_NAME, b"")),
            "id": tank_id,
            "tier": tier,
            "class": CLASS_TO_EN.get(as_int(f1(td, FIELD_TANK_CLASS, 0)), "Unknown"),
            "nation": NATION_TO_EN.get(nation, nation or "Other"),
        }
        if hp and hp > 0:
            item["hp"] = hp
        item["forwardSpeed"] = round(f32(f1(td, FIELD_TANK_SPEED_FORWARD)) or 0)
        item["reverseSpeed"] = round(f32(f1(td, FIELD_TANK_SPEED_BACKWARD)) or 0)
        if turret:
            item["turretRotationSpeed"] = round(f32(f1(turret, FIELD_TURRET_TRAVERSE)) or 0, 1)
        track_traverse = top_track_traverse(td)
        if track_traverse is not None:
            item["hullRotationSpeed"] = round(track_traverse, 1)
        engine_power = top_engine(td)
        weight_kg = as_int(f1(td, FIELD_TANK_WEIGHT))
        if engine_power and weight_kg:
            item["powerToWeightRatio"] = round(engine_power / (weight_kg / 1000.0), 1)
        item["_equipmentPreset"] = as_str(f1(td, FIELD_TANK_EQUIPMENT_PRESET, b""))
        # 权威默认炮：
        # - 7-9 级：顶配炮 = 最高 tier，同 tier 取最高 alpha（T-34-2 取 122mm 400，
        #   与旧 main 规则一致，不能用数组顺序猜）。
        # - 10 级多炮车：存在多个合法终局炮且回放无可靠实际 gunId，
        #   不标 isDefault、不输出 vehicle 级 alphaDamage（避免把不确定值伪装成权威事实）。
        authoritative_gun_id = None
        if guns and not (tier == 10 and len(guns) > 1):
            max_tier = max(g["tier"] for g in guns)
            top_guns = [g for g in guns if g["tier"] == max_tier]
            if top_guns:
                authoritative_gun_id = max(top_guns, key=lambda g: g["shells"][0]["damage"])["gunId"]
        item["guns"] = []
        for gun in guns:
            item["guns"].append({
                "gunId": gun["gunId"],
                "isDefault": gun["gunId"] == authoritative_gun_id,
                "alphaDamage": gun["shells"][0]["damage"],
                "shells": gun["shells"],
                "clip": gun["clip"],
            })
        if authoritative_gun_id is not None:
            item["alphaDamage"] = next(
                g["shells"][0]["damage"] for g in guns if g["gunId"] == authoritative_gun_id
            )
        vehicles[str(tank_id)] = item
    return vehicles


# ---- consumables.pb / provisions.pb -> 每车可用物资 ----

def parse_item_defs(pb_bytes):
    """解析 map<uint32, Item> 定义 -> [{id, name, include, exclude}]。"""
    items = []
    for entry in decode_protobuf(pb_bytes).get(FIELD_MAP_KEY, []):
        kv = decode_protobuf(entry)
        item_id = as_int(f1(kv, FIELD_MAP_KEY))
        if item_id is None:
            continue
        msg = decode_protobuf(f1(kv, FIELD_MAP_VALUE, b""))
        name = i18n_en(f1(msg, FIELD_ITEM_NAME, b""))
        if not name:
            continue  # 占位条目（空名）跳过
        items.append({
            "id": item_id,
            "name": name,
            "include": parse_filters(msg.get(FIELD_ITEM_INCLUDE, [])),
            "exclude": parse_filters(msg.get(FIELD_ITEM_EXCLUDE, [])),
        })
    return items


def parse_filters(raw_filters):
    """ConsumableTankFilter 列表 -> [(kind, payload)]。

    kind: tiers=(min,max) / ids=[...] / categories=[...] / nations=[...]
    """
    filters = []
    for raw_filter in raw_filters:
        fm = decode_protobuf(raw_filter)
        for field, values in fm.items():
            if field == FILTER_TIERS:
                inner = decode_protobuf(f1(fm, field, b""))
                filters.append(("tiers", (as_int(f1(inner, 1)), as_int(f1(inner, 2)))))
            elif field == FILTER_IDS:
                inner = decode_protobuf(f1(fm, field, b""))
                filters.append(("ids", [as_int(v) for v in inner.get(1, [])]))
            elif field == FILTER_CATEGORIES:
                inner = decode_protobuf(f1(fm, field, b""))
                filters.append(("categories", [as_int(v) for v in inner.get(1, [])]))
            elif field == FILTER_NATIONS:
                inner = decode_protobuf(f1(fm, field, b""))
                filters.append(("nations", [as_str(v) for v in inner.get(1, [])]))
    return filters


def vehicle_matches_filter(vehicle, filters):
    """include 过滤器：全部命中才匹配（AND）；空列表 = 无限制。"""
    if not filters:
        return True
    tier = vehicle.get("tier") or 0
    tank_id = vehicle.get("id")
    clip = any(g.get("clip") for g in vehicle.get("guns", []))
    for kind, payload in filters:
        if kind == "tiers":
            lo, hi = payload
            if not ((lo is None or tier >= lo) and (hi is None or tier <= hi)):
                return False
        elif kind == "ids":
            if tank_id not in payload:
                return False
        elif kind == "categories":
            if not (FILTER_CATEGORY_CLIP in payload and clip):
                return False
        elif kind == "nations":
            if vehicle.get("nation").lower() not in payload:
                return False
    return True


def vehicle_matches_any(vehicle, filters):
    """exclude 过滤器：任一命中即排除（OR）。"""
    tier = vehicle.get("tier") or 0
    tank_id = vehicle.get("id")
    clip = any(g.get("clip") for g in vehicle.get("guns", []))
    for kind, payload in filters:
        if kind == "tiers":
            lo, hi = payload
            if (lo is None or tier >= lo) and (hi is None or tier <= hi):
                return True
        elif kind == "ids":
            if tank_id in payload:
                return True
        elif kind == "categories":
            if FILTER_CATEGORY_CLIP in payload and clip:
                return True
        elif kind == "nations":
            if vehicle.get("nation").lower() in payload:
                return True
    return False


def item_allowed(vehicle, item):
    """item（含 include/exclude）对该车是否可用。"""
    if not vehicle_matches_filter(vehicle, item["include"]):
        return False
    if vehicle_matches_any(vehicle, item["exclude"]):
        return False
    return True


def load_catalog():
    """读取 common/wotb-item-catalog-json -> (provision_source_map, consumable_code_map)。"""
    provision_map = {}
    with open(os.path.join(CATALOG_DIR, "provisions.json"), encoding="utf-8") as f:
        for item in json.load(f).get("items", []):
            for source_id in item.get("sourceIds", []):
                provision_map[source_id] = item["id"]
    consumable_map = {}
    with open(os.path.join(CATALOG_DIR, "consumables.json"), encoding="utf-8") as f:
        for item in json.load(f).get("items", []):
            consumable_map[item["id"]] = item["code"]
    return provision_map, consumable_map


def apply_items(vehicles, provision_defs, consumable_defs, provision_map, consumable_map):
    """按过滤规则 + catalog 映射填充 allowedProvision / allowedConsumables。"""
    for vehicle in vehicles.values():
        provisions = sorted({
            provision_map[item["id"]]
            for item in provision_defs
            if item["id"] in provision_map and item_allowed(vehicle, item)
        })
        consumables = sorted({
            consumable_map[item["id"]]
            for item in consumable_defs
            if item["id"] in consumable_map and item_allowed(vehicle, item)
        })
        vehicle["allowedProvision"] = provisions
        vehicle["allowedConsumables"] = consumables
    return vehicles


def parse_equipment_defs(pb_bytes):
    """equipment.pb -> (presets: {name: set(equipment_id)}, equipments: {id: name})。

    EquipmentDefinitions.presets = map<string, EquipmentPreset>，每个 preset 的
    slots = [{left, right}]，车辆可用装备 = 全部槽位 left/right 装备 id 的并集。
    """
    presets = {}
    equipments = {}
    root = decode_protobuf(pb_bytes)
    for raw_preset in root.get(1, []):
        kv = decode_protobuf(raw_preset)
        name = as_str(f1(kv, 1, b""))
        preset = decode_protobuf(f1(kv, 2, b""))
        ids = set()
        for raw_slot in preset.get(1, []):
            slot = decode_protobuf(raw_slot)
            left = as_int(f1(slot, 1))
            right = as_int(f1(slot, 2))
            if left:
                ids.add(left)
            if right:
                ids.add(right)
        presets[name] = ids
    for raw_equipment in root.get(2, []):
        kv = decode_protobuf(raw_equipment)
        equipment_id = as_int(f1(kv, 1))
        if equipment_id is not None:
            equip = decode_protobuf(f1(kv, 2, b""))
            equipments[equipment_id] = i18n_en(f1(equip, 1, b""))
    return presets, equipments


def load_equipment_catalog():
    """读取 catalog equipment.json -> {equipment_id: code}。"""
    equipment_map = {}
    with open(os.path.join(CATALOG_DIR, "equipment.json"), encoding="utf-8") as f:
        for item in json.load(f).get("items", []):
            equipment_map[item["id"]] = item["code"]
    return equipment_map


def apply_equipment(vehicles, presets, equipment_map):
    """按车辆 equipment_preset 的槽位装备并映射 catalog code，填充 allowedEquipment。"""
    for vehicle in vehicles.values():
        preset_name = vehicle.get("_equipmentPreset")
        ids = presets.get(preset_name, set()) if preset_name else set()
        vehicle["allowedEquipment"] = sorted({
            equipment_map[equipment_id]
            for equipment_id in ids
            if equipment_id in equipment_map
        })
    return vehicles


# ---- 旧数据读取 / extraInfo 保留 ----

def load_existing_data(path):
    """读取旧数据，返回 {tank_id: entry}；兼容新旧两种格式，路径缺失时返回 {}。"""
    if not path or not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as file:
        value = json.load(file)
    if not isinstance(value, dict):
        return {}
    vehicles = value.get("vehicles")
    if isinstance(vehicles, list):
        return {
            str(v.get("id")): v
            for v in vehicles if isinstance(v, dict) and v.get("id") is not None
        }
    data = value.get("data", value)
    return data if isinstance(data, dict) else {}


def load_existing_data_dir(directory):
    """读取目录下已有的 tier 文件，返回 {tank_id: entry}（用于保留 extraInfo）。"""
    result = {}
    if not directory or not os.path.isdir(directory):
        return result
    for tier, filename in TIER_FILES.items():
        result.update(load_existing_data(os.path.join(directory, filename)))
    return result


def count_knowledge(data):
    """统计非空 extraInfo（兼容旧 extraKnowledge）的车辆数。"""
    return sum(
        1 for entry in data.values()
        if isinstance(entry, dict) and bool(entry.get("extraInfo") or entry.get("extraKnowledge"))
    )


def verify_knowledge_preservation(old_data, new_data):
    """检查新数据中仍存在的 tank_id，其 extraInfo 是否与旧数据一致。

    只比较新旧共有的 tank_id；被移除的车辆不参与比较。
    返回 (ok, old_knowledge_count, preserved_knowledge_count)。
    """
    old_count = count_knowledge(old_data)
    preserved = 0
    for tank_id, old_entry in old_data.items():
        old_knowledge = old_entry.get("extraInfo") or old_entry.get("extraKnowledge")
        if not isinstance(old_entry, dict) or not old_knowledge:
            continue
        new_entry = new_data.get(tank_id)
        if new_entry is None:
            continue
        if not isinstance(new_entry, dict) or new_entry.get("extraInfo") != old_knowledge:
            return False, old_count, preserved
        preserved += 1
    return True, old_count, preserved


def validate_integrity(new_data, old_data):
    """数据完整性门禁：异常/残缺数据必须失败，禁止写入或提交。

    检查项：
    - 解析结果为空必须失败；
    - 总车辆数或单个 tier 数量相对已有数据异常大幅下降必须失败
      （允许正常新增与少量真实删除，阈值为 MIN_TIER_COUNT_RATIO=0.8）；
    - tank ID 不得重复；
    - 车辆 tier 必须在 {7,8,9,10}（与输出文件等级一致）；
    - 车辆必须有有效 id、name、hp 和至少一把 gun。
    """
    if not new_data:
        raise RuntimeError("TANKOPEDIA_EMPTY: parsed vehicle data is empty")
    seen_ids = set()
    for tank_id, entry in new_data.items():
        if not isinstance(entry, dict):
            raise RuntimeError("TANKOPEDIA_INVALID_ENTRY: %s is not an object" % tank_id)
        vehicle_id = entry.get("id")
        if vehicle_id is None:
            raise RuntimeError("TANKOPEDIA_MISSING_ID: vehicle %s has no id" % tank_id)
        if vehicle_id in seen_ids:
            raise RuntimeError("TANKOPEDIA_DUPLICATE_ID: duplicate tank id %s" % vehicle_id)
        seen_ids.add(vehicle_id)
        if not entry.get("name"):
            raise RuntimeError("TANKOPEDIA_MISSING_NAME: vehicle %s has no name" % tank_id)
        if not entry.get("hp"):
            raise RuntimeError("TANKOPEDIA_MISSING_HP: vehicle %s has no hp" % tank_id)
        if not entry.get("guns"):
            raise RuntimeError("TANKOPEDIA_MISSING_GUN: vehicle %s has no guns" % tank_id)
        if entry.get("tier") not in TIER_FILES:
            raise RuntimeError(
                "TANKOPEDIA_TIER_OUT_OF_RANGE: vehicle %s tier %s not in 7-10"
                % (tank_id, entry.get("tier")))
    if old_data:
        old_total = len(old_data)
        new_total = len(new_data)
        if new_total < old_total * MIN_TIER_COUNT_RATIO:
            raise RuntimeError(
                "TANKOPEDIA_COUNT_DROP: total %d -> %d exceeds allowed decline"
                % (old_total, new_total))
        for tier in TIER_FILES:
            old_tier = sum(1 for e in old_data.values()
                           if isinstance(e, dict) and e.get("tier") == tier)
            new_tier = sum(1 for e in new_data.values() if e.get("tier") == tier)
            if old_tier and new_tier < old_tier * MIN_TIER_COUNT_RATIO:
                raise RuntimeError(
                    "TANKOPEDIA_TIER_DROP: tier %d %d -> %d exceeds allowed decline"
                    % (tier, old_tier, new_tier))
    return True


def merge_extra_info(new_data, old_data):
    """把旧文件中仍存在 tank_id 的非空知识点合并进新数据（extraInfo）。"""
    for tank_id, entry in new_data.items():
        if not isinstance(entry, dict):
            continue
        old_entry = (old_data or {}).get(tank_id)
        old_knowledge = None
        if isinstance(old_entry, dict):
            old_knowledge = old_entry.get("extraInfo") or old_entry.get("extraKnowledge")
        if old_knowledge:
            entry["extraInfo"] = old_knowledge
        else:
            entry["extraInfo"] = ""
    ok, _, _ = verify_knowledge_preservation(old_data or {}, new_data)
    if not ok:
        raise RuntimeError(
            "TANKOPEDIA_KNOWLEDGE_LOST: extraInfo for an existing tank_id was not preserved"
        )
    return new_data


def write_json(path, payload):
    with open(path, "w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")


def vehicle_output(vehicle):
    """输出用 vehicle：剥掉内部 clip / _equipmentPreset 标志。"""
    out = dict(vehicle)
    out.pop("_equipmentPreset", None)
    out["guns"] = [
        {
            "gunId": gun["gunId"],
            "isDefault": gun["isDefault"],
            "alphaDamage": gun["alphaDamage"],
            "shells": gun["shells"],
        }
        for gun in vehicle["guns"]
    ]
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Sync blitzkit (game client) vehicle encyclopedia into per-tier tankopedia files"
    )
    parser.add_argument("--existing-dir", default=REPO_COMMON_DIR,
                        help="旧数据所在目录（读取 tankopedia-tier*.json 保留 extraInfo；默认仓库 common/）")
    parser.add_argument("--output-dir", default=REPO_COMMON_DIR,
                        help="新数据写入目录（写 4 个 tankopedia-tier*.json；Workflow 与 --existing-dir 分离）")
    args = parser.parse_args(argv)

    print("download %s ..." % PB_URL)
    with urllib.request.urlopen(PB_URL, timeout=60) as resp:
        tanks_pb = resp.read()
    with urllib.request.urlopen(CONSUMABLES_URL, timeout=60) as resp:
        consumables_pb = resp.read()
    with urllib.request.urlopen(PROVISIONS_URL, timeout=60) as resp:
        provisions_pb = resp.read()
    with urllib.request.urlopen(EQUIPMENT_URL, timeout=60) as resp:
        equipment_pb = resp.read()
    print("pb bytes: tanks=%d consumables=%d provisions=%d equipment=%d"
          % (len(tanks_pb), len(consumables_pb), len(provisions_pb), len(equipment_pb)))

    old_data = load_existing_data_dir(args.existing_dir)
    vehicles = parse_tanks(tanks_pb)
    total = len(vehicles)
    provision_map, consumable_map = load_catalog()
    vehicles = apply_items(
        vehicles,
        parse_item_defs(provisions_pb),
        parse_item_defs(consumables_pb),
        provision_map,
        consumable_map,
    )
    equipment_presets, _ = parse_equipment_defs(equipment_pb)
    vehicles = apply_equipment(vehicles, equipment_presets, load_equipment_catalog())
    vehicles = merge_extra_info(vehicles, old_data)
    try:
        validate_integrity(vehicles, old_data)
    except RuntimeError as error:
        print("ERROR: %s" % error, file=sys.stderr)
        return 1
    generated_at = datetime.now(timezone.utc).isoformat()
    new_data = {}
    per_tier = {}
    for tier in sorted(TIER_FILES):
        tier_vehicles = [
            vehicle_output(vehicles[key])
            for key in sorted(vehicles, key=lambda k: int(k))
            if vehicles[key].get("tier") == tier
        ]
        per_tier[tier] = tier_vehicles
        for vehicle in tier_vehicles:
            new_data[str(vehicle["id"])] = vehicle
        write_json(os.path.join(args.output_dir, TIER_FILES[tier]), {
            "meta": {
                "source": "blitzkit (assets.blitzkit.app/definitions/tanks.pb)",
                "tier": tier,
                "generated_at": generated_at,
                "count": len(tier_vehicles),
            },
            "vehicles": tier_vehicles,
        })

    ok, old_knowledge, preserved_knowledge = verify_knowledge_preservation(old_data, new_data)
    per_tier_summary = " ".join(
        "tier%d=%d" % (tier, len(per_tier[tier])) for tier in sorted(per_tier)
    )
    print(
        "SAFE_RESULTS source=blitzkit fetched=%d %s "
        "existing_knowledge=%d preserved_knowledge=%d"
        % (total, per_tier_summary, old_knowledge, preserved_knowledge)
    )
    if not ok:
        print("ERROR: extraInfo preservation failed.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
