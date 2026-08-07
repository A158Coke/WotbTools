#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 blitzkit（游戏客户端数据 tanks.pb）生成车辆库 common/tankopedia.json。

用法：
    python update_tankopedia.py [--min-tier 7]

设计约定：
- 数据源为 blitzkit（assets.blitzkit.app/definitions/tanks.pb，游戏客户端直出，
  含最新车辆，如 11.19 的 SPHT；WG 百科会滞后游戏版本，故不再依赖 WG API）。
- 车辆名称用英文（i18n_en）。
- 取**顶配**（精英配置）：炮塔取最高 tier（平局取 hp 高者）上的全部炮。
- hp = TankData.field10（车体）+ 顶配炮塔 hp。
- shells 每发含 {type, damage, penetration}，type 归一化为 ap/apcr/heat/he；
  数组顺序即游戏内弹序（0=标准弹，1=premium，2=第三发），数量随车辆而变（1~3）。
- alphaDamage = 标准弹（shells[0]）伤害。
- 10 级车如果顶配炮塔有多把炮，按炮拆成多条记录：
  - 主记录 key 仍是 ``"<tank_id>"``，取炮列表中的第一把（与 WG 官方默认配置一致，
    已用 WG API 默认配置核对一致，例如 E 100 默认 12,8cm、Atlas 默认单发 V1）；
  - 其余炮生成变体记录，key 为 ``"<tank_id>_<gun_id>"``；
  - 每条记录带 ``gunId``（blitzkit 模块 id）与 ``isDefault`` 标记。
- 手工维护的 ``extraKnowledge`` 按 tank_id 保留合并到该车全部记录；
  仍存在车辆的知识点丢失会直接失败。
- 默认只保留 7-10 级（--min-tier 7；--min-tier 1 保留全部）。
- 脚本无第三方依赖（仅标准库 urllib / struct）。
"""

import argparse
import json
import os
import struct
import sys
import urllib.request
from datetime import datetime, timezone

PB_URL = "https://assets.blitzkit.app/definitions/tanks.pb"

REPO_TANKOPEDIA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "tankopedia.json",
)

# ---- tanks.pb 字段号（已用 WG 官方数据 529/529 交叉验证） ----
FIELD_TANK_ID = 1
FIELD_TANK_DATA = 2
FIELD_TANK_HULL_HP = 10
FIELD_TANK_NATION = 11
FIELD_TANK_NAME = 12
FIELD_TANK_TIER = 16
FIELD_TANK_CLASS = 17
FIELD_TANK_TURRETS = 20
FIELD_TURRET_HP = 2
FIELD_TURRET_TIER = 7
FIELD_TURRET_GUN = 9
FIELD_GUN_ID = 4
FIELD_GUN_SHELLS = 10
FIELD_SHELL_TYPE = 7
FIELD_SHELL_DAMAGE = 4
FIELD_SHELL_PEN = 8
FIELD_PEN_VALUE = 1

# blitzkit TankClass 枚举 -> 中文车种（与前端 replay_values / prompt 措辞一致）
CLASS_TO_ZH = {
    0: "轻坦",
    1: "中坦",
    2: "重坦",
    3: "坦克歼击车",
}

NATION_TO_ZH = {
    "ussr": "苏联",
    "germany": "德国",
    "usa": "美国",
    "china": "中国",
    "france": "法国",
    "uk": "英国",
    "japan": "日本",
    "european": "欧洲",
    "other": "其他",
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
    """炮塔 field9 直接条目（游戏内炮列表，按序），返回 [{'gunId': id, 'shells': [...]}]。

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
        guns.append({"gunId": gun_id, "shells": shells})
    return guns


def parse_tanks(pb_bytes):
    """tanks.pb -> {record_key: entry}。

    10 级多炮车按炮拆分为多条记录：主记录 key 为 tank_id（第一把炮），
    其余为 ``"<tank_id>_<gun_id>"``；10 级以下只保留顶配炮塔的第一把炮。
    """
    data = {}
    for entry in decode_protobuf(pb_bytes).get(1, []):
        kv = decode_protobuf(entry)
        tank_id = f1(kv, FIELD_TANK_ID)
        if tank_id is None:
            continue
        td = decode_protobuf(f1(kv, FIELD_TANK_DATA, b""))
        if not td:
            continue
        tier = as_int(f1(td, FIELD_TANK_TIER))
        nation = as_str(f1(td, FIELD_TANK_NATION, b""))
        base = {
            "name": i18n_en(f1(td, FIELD_TANK_NAME, b"")),
            "tier": tier,
            "class": CLASS_TO_ZH.get(as_int(f1(td, FIELD_TANK_CLASS, 0)), "未知"),
            "nation": NATION_TO_ZH.get(nation, nation or "未知"),
        }
        turret, hp = top_turret(td)
        if hp and hp > 0:
            base["hp"] = hp
        guns = guns_of_turret(turret) if turret else []
        if not guns:
            data[str(tank_id)] = base
            continue

        def record_for(gun, is_default):
            item = dict(base)
            item["gunId"] = gun["gunId"]
            item["isDefault"] = is_default
            item["alphaDamage"] = gun["shells"][0]["damage"]
            item["shells"] = gun["shells"]
            return item

        key = str(tank_id)
        if tier == 10 and len(guns) > 1:
            data[key] = record_for(guns[0], True)
            for gun in guns[1:]:
                data["%s_%s" % (key, gun["gunId"])] = record_for(gun, False)
        else:
            data[key] = record_for(guns[0], True)
    return data


def load_existing_data(path):
    """读取旧数据，返回 {tank_id: entry}；路径缺失/格式错误时返回 {}。"""
    if not path or not os.path.exists(path):
        return {}

    with open(path, encoding="utf-8") as file:
        value = json.load(file)

    if not isinstance(value, dict):
        return {}

    data = value.get("data", value)
    return data if isinstance(data, dict) else {}


def base_tank_key(record_key):
    """记录 key -> 车 tank_id：``"<tank_id>_<gun_id>"`` 变体归并到 ``"<tank_id>"``。"""
    return str(record_key).split("_", 1)[0]


def count_knowledge(data):
    """统计非空 extraKnowledge 的车辆数。"""
    return sum(
        1 for entry in data.values()
        if isinstance(entry, dict) and bool(entry.get("extraKnowledge"))
    )


def verify_knowledge_preservation(old_data, new_data):
    """检查新数据中仍存在的 tank_id，其全部记录的非空 extraKnowledge 是否与旧数据一致。

    只比较新旧共有的 tank_id；该车的全部记录（主记录 + 炮变体）都必须带同一份知识。
    被移除的车辆不参与比较。
    返回 (ok, old_knowledge_count, preserved_knowledge_count)。
    """
    old_count = count_knowledge(old_data)
    preserved = 0
    for tank_id, old_entry in old_data.items():
        if not isinstance(old_entry, dict) or not old_entry.get("extraKnowledge"):
            continue
        matched = False
        for record_key, new_entry in new_data.items():
            if base_tank_key(record_key) != tank_id:
                continue
            matched = True
            if (
                not isinstance(new_entry, dict)
                or new_entry.get("extraKnowledge") != old_entry.get("extraKnowledge")
            ):
                return False, old_count, preserved
            preserved += 1
        # 旧车在新数据中已不存在（如 WG/客户端真实删除）时，不参与比较
        if not matched:
            continue
    return True, old_count, preserved


def merge_extra_knowledge(new_data, old_data):
    """把旧文件中仍存在 tank_id 的非空 extraKnowledge 合并进该车全部记录。

    合并后必须通过 verify_knowledge_preservation，否则抛异常（防止知识意外减少）。
    """
    for tank_id, entry in new_data.items():
        if not isinstance(entry, dict):
            continue
        old_entry = (old_data or {}).get(base_tank_key(tank_id))
        if isinstance(old_entry, dict) and old_entry.get("extraKnowledge"):
            entry["extraKnowledge"] = old_entry["extraKnowledge"]
    ok, _, _ = verify_knowledge_preservation(old_data or {}, new_data)
    if not ok:
        raise RuntimeError(
            "TANKOPEDIA_KNOWLEDGE_LOST: extraKnowledge for an existing tank_id was not preserved"
        )
    return new_data


def filter_by_min_tier(data, min_tier):
    """只保留 tier >= min_tier 的车辆；min_tier <= 1 表示保留全部。"""
    if not min_tier or min_tier <= 1:
        return data
    return {
        tank_id: entry for tank_id, entry in data.items()
        if (entry.get("tier") or 0) >= min_tier
    }


def write_json(path, payload):
    with open(path, "w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Sync blitzkit (game client) vehicle encyclopedia into tankopedia.json"
    )
    parser.add_argument("--min-tier", type=int, default=7,
                        help="只保留该等级及以上的车辆（默认 7；1 = 全部）")
    parser.add_argument("--existing", default=REPO_TANKOPEDIA,
                        help="旧数据读取路径（默认仓库 common/tankopedia.json；用于保留 extraKnowledge）")
    parser.add_argument("--output", default=REPO_TANKOPEDIA,
                        help="新数据写入路径（默认仓库 common/tankopedia.json；Workflow 与 --existing 分离）")
    args = parser.parse_args(argv)

    print("download %s ..." % PB_URL)
    with urllib.request.urlopen(PB_URL, timeout=60) as resp:
        pb_bytes = resp.read()
    print("pb bytes:", len(pb_bytes))

    old_data = load_existing_data(args.existing)
    data = parse_tanks(pb_bytes)
    total = len(data)
    data = filter_by_min_tier(data, args.min_tier)
    data = merge_extra_knowledge(data, old_data)
    data = dict(sorted(data.items(), key=lambda kv: int(kv[0])))

    output = {
        "meta": {
            "source": "blitzkit (assets.blitzkit.app/definitions/tanks.pb)",
            "min_tier": args.min_tier,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "count": len(data),
            "tank_count": len({base_tank_key(k) for k in data}),
        },
        "data": data,
    }
    write_json(args.output, output)

    ok, old_knowledge, preserved_knowledge = verify_knowledge_preservation(old_data, data)
    print(
        "SAFE_RESULTS source=blitzkit fetched=%d tier_ge_%d=%d "
        "existing_knowledge=%d preserved_knowledge=%d"
        % (total, args.min_tier, len(data), old_knowledge, preserved_knowledge)
    )
    if not ok:
        print("ERROR: extraKnowledge preservation failed.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
