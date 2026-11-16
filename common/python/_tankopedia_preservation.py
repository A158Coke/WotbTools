"""Existing output reads, extraInfo preservation and fail-closed gates."""
import json
import os
from _tankopedia_config import MIN_TIER_COUNT_RATIO, TIER_FILES


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


def validate_integrity(new_data, old_data):
    """数据完整性门禁：异常/残缺数据必须失败，禁止写入或提交。

    检查项：
    - 解析结果为空必须失败；
    - 总车辆数或单个 tier 数量相对已有数据异常大幅下降必须失败
      （允许正常新增与少量真实删除，阈值为 MIN_TIER_COUNT_RATIO=0.8）；
    - tank ID 不得重复；
    - 车辆 tier 必须在 1-10（与输出文件等级一致）；
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
                "TANKOPEDIA_TIER_OUT_OF_RANGE: vehicle %s tier %s not in 1-10"
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
