"""Full-tier roster contract and public vehicle JSON projection."""
import json
import os
from _tankopedia_config import MIN_TIER_COUNT_RATIO

ROSTER_FILE = "tank_ids.json"


def roster_payload(vehicles, generated_at, game_version=None, source_hashes=None):
    """未过滤的解析结果 → 名册 payload（id 升序；id 或名字缺失的条目丢弃）。"""
    roster = {}
    for entry in vehicles.values():
        if not isinstance(entry, dict):
            continue
        tank_id = entry.get("id")
        name = (entry.get("name") or "").strip()
        if not isinstance(tank_id, int) or isinstance(tank_id, bool) or tank_id <= 0 or not name:
            continue
        roster[str(tank_id)] = name
    meta = {"source": "blitzkit production definitions"}
    if game_version:
        meta["source_game_version"] = game_version
    if source_hashes and source_hashes.get("tanks"):
        meta["source_hashes"] = {"tanks": source_hashes["tanks"]}
    meta["generated_at"] = generated_at
    meta["count"] = len(roster)
    return {
        "meta": meta,
        "vehicles": {key: roster[key] for key in sorted(roster, key=int)},
    }


def validate_roster(payload, old_roster):
    """fail closed：名册为空、或相对已入库名册骤降（MIN_TIER_COUNT_RATIO）必须失败。"""
    vehicles = payload.get("vehicles") or {}
    if not vehicles:
        raise RuntimeError("TANK_ROSTER_EMPTY: parsed vehicle roster is empty")
    old = (old_roster or {}).get("vehicles") or {}
    if old and len(vehicles) < len(old) * MIN_TIER_COUNT_RATIO:
        raise RuntimeError(
            "TANK_ROSTER_COUNT_DROP: %d -> %d exceeds allowed decline"
            % (len(old), len(vehicles))
        )
    return True


def load_existing_roster(directory):
    """已入库名册（缺文件 → {}；用于数量骤降门禁）。"""
    path = os.path.join(directory, ROSTER_FILE)
    if not os.path.isfile(path):
        return {}
    with open(path, encoding="utf-8") as file:
        return json.load(file)


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
