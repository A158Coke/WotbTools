# -*- coding: utf-8 -*-
"""从 blitzkit（游戏客户端数据）生成车辆库 common/tankopedia-tier{1..10}.json。

用法：
    python update_tankopedia.py [--existing-dir common] [--output-dir common]

输出为按等级拆分的 10 个文件（meta + vehicles 数组）：
    common/tankopedia-tier1.json   // 1 级车辆
    ...
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
                                        //   1-9 级 = 顶配炮（最高 tier，同 tier 取最高 alpha）
                                        //   10 级多炮车 = 全部 false（回放无可靠实际炮，不伪装）
          "allowedProvision": [...],    // catalog 逻辑物资 id（SMALL_FOOD 等）
          "allowedConsumables": [...],  // catalog 消耗品 code（AUTOMATIC_FIRE_EXTINGUISHER 等）
          "allowedEquipment": [...],    // catalog 装备 code（含 VK 72.01 俯角 / 履带齿等专属装备）
          "alphaDamage": 420,           // 仅唯一权威时输出：单炮车 / 1-9 顶配炮；
                                        // 10 级多炮车省略（避免把不确定炮伤伪装成权威事实）
          "extraInfo": ""               // 手工知识点（原 extraKnowledge，按 tank_id 保留合并）
        }
      ]
    }

设计约定：
- 数据源为 blitzkit production definitions（tanks.pb + consumables.pb + provisions.pb + equipment.pb，
  游戏客户端直出并随 production 数据更新；WG 百科可能滞后游戏版本，故不依赖 WG API）。
- 每辆车一条记录，guns 数组含顶配炮塔上的全部炮；isDefault 标记权威默认炮：
  - 1-9 级：顶配炮 = 最高 tier，同 tier 取最高 alpha（已用 origin/main 全量 454/457 验证；
    T-34-2 取 122mm 400，不能用数组顺序猜）。
  - 10 级多炮车：存在多个合法终局炮，回放无可靠实际 gunId，全部 isDefault=false、
    不输出 vehicle 级 alphaDamage，运行时 AI 结构化事实省略炮伤（不输出虚假唯一炮伤）。
  - 10 级单炮车：正常输出 alphaDamage。
- 每车可用物资：由 blitzkit 的 include/exclude 过滤器（tier/ids/categories/nations）
  判定，再映射到 common/wotb-item-catalog-json 的逻辑 id / code；
  catalog 未收录的道具（多为活动/娱乐模式专属）不输出。
- extraInfo 按 tank_id 保留合并；仍存在车辆的知识点丢失会直接失败。
- 输出 1-10 级十份资料；资料覆盖范围不决定评分或十级专属业务资格。
- 脚本无第三方依赖（仅标准库 urllib / struct / json）。
"""
import argparse
import os
import sys
import urllib.request
from datetime import datetime, timezone
from _tankopedia_config import (
    BLITZKIT_API_BASE, CATALOG_DIR, CLASS_TO_EN, CONSUMABLES_URL,
    EQUIPMENT_URL, FIELD_ENGINE_POWER, FIELD_ENGINE_TIER, FIELD_GUN_ID,
    FIELD_GUN_SHELLS, FIELD_GUN_TIER, FIELD_ITEM_EXCLUDE, FIELD_ITEM_INCLUDE,
    FIELD_ITEM_NAME, FIELD_MAP_KEY, FIELD_MAP_VALUE, FIELD_PEN_VALUE,
    FIELD_SHELL_DAMAGE, FIELD_SHELL_PEN, FIELD_SHELL_TYPE, FIELD_TANK_CLASS,
    FIELD_TANK_DATA, FIELD_TANK_ENGINES, FIELD_TANK_EQUIPMENT_PRESET,
    FIELD_TANK_HULL_HP, FIELD_TANK_ID, FIELD_TANK_NAME, FIELD_TANK_NATION,
    FIELD_TANK_SPEED_BACKWARD, FIELD_TANK_SPEED_FORWARD, FIELD_TANK_TIER,
    FIELD_TANK_TRACKS, FIELD_TANK_TURRETS, FIELD_TANK_WEIGHT,
    FIELD_TRACK_TIER, FIELD_TRACK_TRAVERSE, FIELD_TURRET_GUN, FIELD_TURRET_HP,
    FIELD_TURRET_TIER, FIELD_TURRET_TRAVERSE, FILTER_CATEGORIES,
    FILTER_CATEGORY_CLIP, FILTER_IDS, FILTER_NATIONS, FILTER_TIERS,
    MODELED_ITEM_TIERS, MIN_TIER_COUNT_RATIO, NATION_TO_EN, PB_URL,
    PROVISIONS_URL, REPO_COMMON_DIR, SHELL_TYPE_NORM, TIER_FILES,
)
from _tankopedia_proto import _read_varint, as_int, as_str, decode_protobuf, f1, f32
from _tankopedia_vehicle import (
    filter_to_business_tiers, guns_of_turret, i18n_en, parse_tanks,
    shell_entry, top_engine, top_track_traverse, top_turret,
)
from _tankopedia_items import (
    apply_equipment, apply_items, item_allowed, load_catalog,
    load_equipment_catalog, parse_equipment_defs, parse_filters, parse_item_defs,
    vehicle_matches_any, vehicle_matches_filter,
)
from _tankopedia_preservation import (
    count_knowledge, load_existing_data, load_existing_data_dir, merge_extra_info,
    validate_integrity, verify_knowledge_preservation, write_json,
)
from _tankopedia_roster import (
    ROSTER_FILE, load_existing_roster, roster_payload, validate_roster, vehicle_output,
)

def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Sync blitzkit (game client) vehicle encyclopedia into per-tier tankopedia files"
    )
    parser.add_argument("--existing-dir", default=REPO_COMMON_DIR,
                        help="旧数据所在目录（读取 tankopedia-tier*.json 保留 extraInfo；默认仓库 common/）")
    parser.add_argument("--output-dir", default=REPO_COMMON_DIR,
                        help="新数据写入目录（写 10 个 tankopedia-tier*.json；Workflow 与 --existing-dir 分离）")
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
    all_vehicles = parse_tanks(tanks_pb)
    total = len(all_vehicles)
    vehicles = all_vehicles
    item_vehicles = filter_to_business_tiers(vehicles)
    provision_map, consumable_map = load_catalog()
    apply_items(
        item_vehicles,
        parse_item_defs(provisions_pb),
        parse_item_defs(consumables_pb),
        provision_map,
        consumable_map,
    )
    equipment_presets, _ = parse_equipment_defs(equipment_pb)
    apply_equipment(item_vehicles, equipment_presets, load_equipment_catalog())
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
                "source": "blitzkit production definitions",
                "tier": tier,
                "generated_at": generated_at,
                "count": len(tier_vehicles),
            },
            "vehicles": tier_vehicles,
        })

    roster = roster_payload(all_vehicles, generated_at)
    try:
        validate_roster(roster, load_existing_roster(args.existing_dir))
    except RuntimeError as error:
        print("ERROR: %s" % error, file=sys.stderr)
        return 1
    write_json(os.path.join(args.output_dir, ROSTER_FILE), roster)

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
