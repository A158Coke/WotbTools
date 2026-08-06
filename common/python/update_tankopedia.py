#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 Wargaming.net 官方 WoT Blitz 车辆百科拉取数据，写入仓库根 common/tankopedia.json。

用法：
    WG_APPLICATION_ID=<application_id> python update_tankopedia.py [--region asia] [--min-tier 7]

设计约定：
- 默认只保留 7-10 级车辆（--min-tier 7；--min-tier 1 保留全部）。
- 手工维护的 ``extraKnowledge`` 字段会被保留：刷新后已存在的 tank_id 继续沿用旧知识点，
  新车型没有 extraKnowledge，删除的车型一并消失——官方数据与个人知识点共存于同一个 json。
- 输出字段：name / tier / class(中文) / nation(中文) / alphaDamage / hp / extraKnowledge。
- 脚本无第三方依赖（仅标准库 urllib）。
"""

import argparse
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import datetime, timezone

API_HOST = "https://api.wotblitz.{region}/wotb/encyclopedia/vehicles/"
DEFAULT_FIELDS = "name,tier,type,nation,hp,gun.damage"

# WG type 代码 -> 中文车种（与前端 replay_values / prompt 措辞一致）
TYPE_TO_ZH = {
    "lightTank": "轻坦",
    "mediumTank": "中坦",
    "heavyTank": "重坦",
    "AT-SPG": "坦克歼击车",
}

# WG nation 代码 -> 中文国家
NATION_TO_ZH = {
    "ussr": "苏联",
    "usa": "美国",
    "germany": "德国",
    "france": "法国",
    "uk": "英国",
    "japan": "日本",
    "china": "中国",
    "czech": "捷克斯洛伐克",
    "european": "欧洲",
    "italy": "意大利",
    "poland": "波兰",
    "sweden": "瑞典",
}

OUTPUT = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "tankopedia.json")


def fetch_vehicles(app_id, region, fields, language):
    """分页拉取全部车辆，返回 {tank_id: {...}}。"""
    data = {}
    offset = 0
    limit = 100
    while True:
        query = urllib.parse.urlencode({
            "application_id": app_id,
            "fields": fields,
            "language": language,
            "limit": str(limit),
            "offset": str(offset),
        })
        url = API_HOST.format(region=region) + "?" + query
        print("GET", API_HOST.format(region=region), "limit=%d offset=%d" % (limit, offset))
        with urllib.request.urlopen(url, timeout=60) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        if payload.get("status") != "ok":
            raise RuntimeError("WG API error: %s" % json.dumps(payload, ensure_ascii=False)[:500])
        batch = payload.get("data") or {}
        if not batch:
            break
        data.update(batch)
        if len(batch) < limit:
            break
        offset += limit
    return data


def as_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def transform(vehicles):
    """WG 原始字段 -> tankopedia.json 条目（中文车种/国家 + alphaDamage/hp）。"""
    out = {}
    for tank_id, v in vehicles.items():
        tier = as_int(v.get("tier"))
        alpha = None
        gun = v.get("gun")
        if isinstance(gun, dict):
            damages = gun.get("damage")
            if isinstance(damages, list) and damages:
                alpha = max(as_int(d) or 0 for d in damages)
            elif damages is not None:
                alpha = as_int(damages)
        entry = {
            "name": v.get("name") or "#" + tank_id,
            "tier": tier,
            "class": TYPE_TO_ZH.get(v.get("type", ""), v.get("type") or "未知"),
            "nation": NATION_TO_ZH.get(v.get("nation", ""), v.get("nation") or "未知"),
        }
        if alpha and alpha > 0:
            entry["alphaDamage"] = alpha
        hp = as_int(v.get("hp"))
        if hp and hp > 0:
            entry["hp"] = hp
        out[str(tank_id)] = entry
    return out


def merge_extra_knowledge(new_data, old_data):
    """刷新后保留旧文件中同名 tank_id 的手工 extraKnowledge。"""
    for tank_id, entry in new_data.items():
        old = (old_data or {}).get(tank_id)
        if old and old.get("extraKnowledge"):
            entry["extraKnowledge"] = old["extraKnowledge"]
    return new_data


def main():
    parser = argparse.ArgumentParser(description="Sync WG official vehicle encyclopedia into tankopedia.json")
    parser.add_argument("--region", default="asia", choices=["asia", "eu", "com"])
    parser.add_argument("--min-tier", type=int, default=7, help="只保留该等级及以上的车辆（默认 7）")
    parser.add_argument("--language", default="zh-cn")
    parser.add_argument("--app-id", default=None, help="WG application_id（默认读环境变量 WG_APPLICATION_ID）")
    parser.add_argument("--output", default=OUTPUT,
                        help="输出 json 路径（默认仓库根 common/tankopedia.json；VPS 同步时传 /tmp 下路径）")
    args = parser.parse_args()

    app_id = args.app_id or os.environ.get("WG_APPLICATION_ID", "").strip()
    if not app_id:
        print("ERROR: missing WG application_id; set WG_APPLICATION_ID or pass --app-id.", file=sys.stderr)
        sys.exit(1)

    old_data = {}
    if os.path.exists(OUTPUT):
        with open(OUTPUT, encoding="utf-8") as f:
            old = json.load(f)
        old_data = old.get("data", old) if isinstance(old, dict) else {}

    vehicles = fetch_vehicles(app_id, args.region, DEFAULT_FIELDS, args.language)
    print("fetched vehicles:", len(vehicles))

    data = transform(vehicles)
    if args.min_tier > 1:
        before = len(data)
        data = {tid: e for tid, e in data.items() if (e.get("tier") or 0) >= args.min_tier}
        print("tier >= %d: %d -> %d" % (args.min_tier, before, len(data)))

    data = merge_extra_knowledge(data, old_data)
    data = dict(sorted(data.items(), key=lambda kv: int(kv[0])))

    output = {
        "meta": {
            "source": "wargaming-official",
            "region": args.region,
            "min_tier": args.min_tier,
            "language": args.language,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "count": len(data),
        },
        "data": data,
    }
    with open(args.output, "w", encoding="utf-8", newline="\n") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)
        f.write("\n")
    print("wrote", args.output, "entries:", len(data))


if __name__ == "__main__":
    main()
