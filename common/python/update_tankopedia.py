#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 Wargaming.net 官方 WoT Blitz 车辆百科拉取数据，写入仓库根 common/tankopedia.json。

用法：
    WG_APPLICATION_ID=<application_id> python update_tankopedia.py [--region asia] [--min-tier 7]
    WG_APPLICATION_ID=<application_id> python update_tankopedia.py --existing old.json --output new.json

设计约定：
- 默认只保留 7-10 级车辆（--min-tier 7；--min-tier 1 保留全部）。
- 旧数据只通过 --existing 读取（默认仓库 common/tankopedia.json），新数据只写 --output
  （默认同路径）；生产 Workflow 必须使用不同路径，避免读取与写入互相覆盖。
- 手工维护的 ``extraKnowledge`` 会被保留：刷新后新数据中仍存在的 tank_id 继续沿用旧知识点，
  被 WG 官方删除的车型一并消失；若某个仍存在 tank_id 的知识点丢失，脚本直接失败。
- alphaDamage 规则：取官方 ``default_profile.shells`` 第一发（标准弹）伤害，禁止使用 max。
  （真实响应验证：shells 按弹种顺序排列，第一发为该车标准弹，如 IS-4 首发 AP 420、
  KV-2 首发 HE 450；HE 往往伤害更高，max 会错取 HE。）
- WG 百科滞后于游戏版本（11.19 新车上线后百科未收录）：缺失的 tank_id 用 blitzkit
  （游戏客户端数据）兜底——WG 有则用 WG，WG 没有才补 blitzkit 条目；兜底条目不携带
  premium 等不消费字段，且同样受 --min-tier 过滤。meta 记录 fallback_count。
- 日志不输出 application_id、完整 URL 或完整响应。
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
DEFAULT_FIELDS = "name,tier,type,nation,default_profile.hp,default_profile.shells"
DEFAULT_LANGUAGE = "zh-cn"
PAGE_LIMIT = 100
MAX_PAGES = 100

REPO_TANKOPEDIA = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "tankopedia.json",
)
FALLBACK_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "blitzkit_fallback.json")

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


def as_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


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


def count_knowledge(data):
    """统计非空 extraKnowledge 的车辆数。"""
    return sum(
        1 for entry in data.values()
        if isinstance(entry, dict) and bool(entry.get("extraKnowledge"))
    )


def verify_knowledge_preservation(old_data, new_data):
    """检查新数据中仍存在的 tank_id，其非空 extraKnowledge 是否与旧数据一致。

    只比较新旧共有的 tank_id；被 WG 官方删除的车辆不参与比较。
    返回 (ok, old_knowledge_count, preserved_knowledge_count)。
    """
    old_count = count_knowledge(old_data)
    preserved = 0
    for tank_id, old_entry in old_data.items():
        if not isinstance(old_entry, dict) or not old_entry.get("extraKnowledge"):
            continue
        new_entry = new_data.get(tank_id)
        if new_entry is None:
            continue
        if (
            not isinstance(new_entry, dict)
            or new_entry.get("extraKnowledge") != old_entry.get("extraKnowledge")
        ):
            return False, old_count, preserved
        preserved += 1
    return True, old_count, preserved


def merge_extra_knowledge(new_data, old_data):
    """把旧文件中仍存在 tank_id 的非空 extraKnowledge 合并进新数据。

    合并后必须通过 verify_knowledge_preservation，否则抛异常（防止知识意外减少）。
    """
    for tank_id, entry in new_data.items():
        if not isinstance(entry, dict):
            continue
        old_entry = (old_data or {}).get(tank_id)
        if isinstance(old_entry, dict) and old_entry.get("extraKnowledge"):
            entry["extraKnowledge"] = old_entry["extraKnowledge"]
    ok, _, _ = verify_knowledge_preservation(old_data or {}, new_data)
    if not ok:
        raise RuntimeError(
            "TANKOPEDIA_KNOWLEDGE_LOST: extraKnowledge for an existing tank_id was not preserved"
        )
    return new_data


def http_get_vehicles(url, region, opener=None):
    """GET 并解析 WG vehicles 响应，返回 (data, total)。

    错误日志不含 application_id / 完整 URL / 完整响应。
    """
    try:
        if opener is not None:
            with opener.open(url, timeout=60) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
        else:
            with urllib.request.urlopen(url, timeout=60) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
    except Exception as exc:
        raise RuntimeError("WG_API_REQUEST_FAILED region=%s error=%s" % (region, exc)) from exc
    if payload.get("status") != "ok":
        error = payload.get("error") if isinstance(payload.get("error"), dict) else {}
        message = error.get("message") or payload.get("status")
        raise RuntimeError("WG_API_ERROR region=%s message=%s" % (region, message))
    batch = payload.get("data")
    meta = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    total = meta.get("count")
    return (batch if isinstance(batch, dict) else {}), total


def fetch_vehicles(app_id, region, fields, language, opener=None):
    """分页拉取全部车辆，返回 (data, pages)。

    真实契约（2026-08-06 实测）：Blitz encyclopedia/vehicles 忽略 limit/offset，
    单次响应即返回完整数据集（meta.count 即全集），因此第一页就会终止。
    保留 MAX_PAGES 与无进展检测作为未来契约变化的防御：
    每页累计数量必须增长，否则视为死循环。
    日志只输出 region / offset / page / batch size / 累计车辆数，不输出 application_id。
    """
    data = {}
    offset = 0
    pages = 0
    while True:
        pages += 1
        if pages > MAX_PAGES:
            raise RuntimeError("WG_PAGINATION_PAGE_LIMIT_EXCEEDED")
        query = urllib.parse.urlencode({
            "application_id": app_id,
            "fields": fields,
            "language": language,
            "limit": str(PAGE_LIMIT),
            "offset": str(offset),
        })
        url = API_HOST.format(region=region) + "?" + query
        print("GET region=%s offset=%d" % (region, offset))
        batch, total = http_get_vehicles(url, region, opener=opener)
        if not batch:
            break
        previous_count = len(data)
        data.update(batch)
        if len(data) == previous_count:
            raise RuntimeError("WG_PAGINATION_NO_PROGRESS")
        print(
            "page=%d offset=%d batch_size=%d cumulative=%d"
            % (pages, offset, len(batch), len(data))
        )
        if len(batch) < PAGE_LIMIT or (total is not None and len(data) >= total):
            break
        offset += PAGE_LIMIT
    return data, pages


def log_shell_samples(vehicles, count=5):
    """打印前几辆车的 default_profile.shells（脱敏，无 application_id / 完整响应），用于人工确认弹序。"""
    print("shell samples (first %d vehicles):" % count)
    for tank_id, vehicle in list(vehicles.items())[:count]:
        profile = vehicle.get("default_profile") if isinstance(vehicle, dict) else None
        shells = profile.get("shells") if isinstance(profile, dict) else None
        sample = [(shell.get("type"), shell.get("damage")) for shell in shells] \
            if isinstance(shells, list) else None
        print(
            "  tank=%s name=%s shells=%s"
            % (tank_id, vehicle.get("name"), json.dumps(sample, ensure_ascii=False))
        )


def alpha_from_profile(profile, rule):
    """从 default_profile.shells 取炮伤。

    rule="first"：取第一发（标准弹）伤害。真实响应验证：shells 按弹种顺序排列，第一发为该车
    标准弹（如 IS-4 首发 AP 420 / KV-2 首发 HE 450 / T49 ATM 首发 HEAT 560），
    而 HE 往往伤害更高，因此禁止使用 max。
    rule="conservative"：返回 None，由调用方保留旧值或让新车辆缺失该字段。
    """
    if not isinstance(profile, dict):
        return None
    shells = profile.get("shells")
    if not isinstance(shells, list) or not shells:
        return None
    if rule == "first" and isinstance(shells[0], dict):
        return as_int(shells[0].get("damage"))
    return None


def hp_from_profile(profile):
    """从 default_profile.hp 取车辆血量；缺失返回 None。"""
    if not isinstance(profile, dict):
        return None
    return as_int(profile.get("hp"))


def transform(vehicles, alpha_rule, old_data):
    """WG 原始字段 -> tankopedia.json 条目（中文车种/国家 + alphaDamage/hp）。"""
    old_data = old_data or {}
    out = {}
    for tank_id, vehicle in vehicles.items():
        tier = as_int(vehicle.get("tier"))
        profile = vehicle.get("default_profile")
        if alpha_rule == "first":
            alpha = alpha_from_profile(profile, "first")
        else:
            old_entry = old_data.get(tank_id)
            alpha = as_int(old_entry.get("alphaDamage")) if isinstance(old_entry, dict) else None
        entry = {
            "name": vehicle.get("name") or "#" + tank_id,
            "tier": tier,
            "class": TYPE_TO_ZH.get(vehicle.get("type", ""), vehicle.get("type") or "未知"),
            "nation": NATION_TO_ZH.get(vehicle.get("nation", ""), vehicle.get("nation") or "未知"),
        }
        if alpha and alpha > 0:
            entry["alphaDamage"] = alpha
        hp = hp_from_profile(profile)
        if hp and hp > 0:
            entry["hp"] = hp
        out[str(tank_id)] = entry
    return out


def filter_by_min_tier(data, min_tier):
    """只保留 tier >= min_tier 的车辆；min_tier <= 1 表示保留全部。"""
    if not min_tier or min_tier <= 1:
        return data
    return {
        tank_id: entry for tank_id, entry in data.items()
        if (entry.get("tier") or 0) >= min_tier
    }


def merge_fallback(new_data, fallback_data):
    """WG 缺失的 tank_id 用 blitzkit 兜底，返回 (merged, fallback_ids)。

    WG 优先：相同 tank_id 不覆盖；兜底条目只复制受支持字段
    （name/tier/class/nation/alphaDamage/hp），不携带 premium 等不消费字段。
    """
    fallback_data = fallback_data or {}
    fallback_ids = set()
    for tank_id, entry in fallback_data.items():
        if tank_id in new_data or not isinstance(entry, dict):
            continue
        clean = {
            "name": entry.get("name") or "#" + tank_id,
            "tier": entry.get("tier"),
            "class": entry.get("class"),
            "nation": entry.get("nation"),
        }
        for field in ("alphaDamage", "hp"):
            value = entry.get(field)
            if value not in (None, ""):
                clean[field] = value
        new_data[tank_id] = clean
        fallback_ids.add(tank_id)
    return new_data, fallback_ids


def write_json(path, payload):
    with open(path, "w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Sync WG official vehicle encyclopedia into tankopedia.json"
    )
    parser.add_argument("--region", default="asia", choices=["asia", "eu", "com"])
    parser.add_argument("--min-tier", type=int, default=7,
                        help="只保留该等级及以上的车辆（默认 7；1 = 全部）")
    parser.add_argument("--language", default=DEFAULT_LANGUAGE)
    parser.add_argument("--existing", default=REPO_TANKOPEDIA,
                        help="旧数据读取路径（默认仓库 common/tankopedia.json；Workflow 必须与 --output 不同）")
    parser.add_argument("--fallback", default=FALLBACK_PATH,
                        help="blitzkit 兜底数据路径（默认 common/python/blitzkit_fallback.json；"
                             "WG 百科缺失的新车由此补全）")
    parser.add_argument("--output", default=REPO_TANKOPEDIA,
                        help="新数据写入路径（默认仓库 common/tankopedia.json）")
    parser.add_argument("--alpha-rule", choices=["first", "conservative"], default="first",
                        help="alphaDamage 规则：first=default_profile.shells 第一发标准弹（已验证）；"
                             "conservative=保留旧值/新车辆缺失")
    args = parser.parse_args(argv)

    app_id = os.environ.get("WG_APPLICATION_ID", "").strip()
    if not app_id:
        print("ERROR: missing WG application_id; set WG_APPLICATION_ID.", file=sys.stderr)
        return 1

    old_data = load_existing_data(args.existing)
    fallback_data = load_existing_data(args.fallback)
    vehicles, pages = fetch_vehicles(app_id, args.region, DEFAULT_FIELDS, args.language)
    print("fetched_vehicles=%d pages=%d" % (len(vehicles), pages))
    log_shell_samples(vehicles)

    data = transform(vehicles, args.alpha_rule, old_data)
    data, fallback_ids = merge_fallback(data, fallback_data)
    data = filter_by_min_tier(data, args.min_tier)
    data = merge_extra_knowledge(data, old_data)
    data = dict(sorted(data.items(), key=lambda kv: int(kv[0])))
    fallback_count = sum(1 for tank_id in data if tank_id in fallback_ids)

    output = {
        "meta": {
            "source": "wargaming-official",
            "fallback_source": "blitzkit (game client data, 补 WG 百科未收录的新车)",
            "fallback_count": fallback_count,
            "region": args.region,
            "min_tier": args.min_tier,
            "language": args.language,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "count": len(data),
        },
        "data": data,
    }
    write_json(args.output, output)

    ok, old_knowledge, preserved_knowledge = verify_knowledge_preservation(old_data, data)
    print(
        "SAFE_RESULTS region=%s pages=%d fetched=%d tier_ge_%d=%d "
        "existing_knowledge=%d preserved_knowledge=%d fallback=%d alpha_rule=%s"
        % (
            args.region, pages, len(vehicles), args.min_tier, len(data),
            old_knowledge, preserved_knowledge, fallback_count, args.alpha_rule,
        )
    )
    if not ok:
        print("ERROR: extraKnowledge preservation failed.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
