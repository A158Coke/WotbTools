"""Tank equipment/consumable filter parsing and catalog projection."""
import json
import os
from _tankopedia_config import (
    CATALOG_DIR, FIELD_ITEM_EXCLUDE, FIELD_ITEM_INCLUDE, FIELD_ITEM_NAME,
    FIELD_MAP_KEY, FIELD_MAP_VALUE, FILTER_CATEGORIES, FILTER_CATEGORY_CLIP,
    FILTER_IDS, FILTER_NATIONS, FILTER_TIERS,
)
from _tankopedia_proto import as_int, as_str, decode_protobuf, f1
from _tankopedia_vehicle import i18n_en


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
            continue
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


def item_allowed(vehicle, item):
    """item（含 include/exclude）对该车是否可用。"""
    if not vehicle_matches_filter(vehicle, item["include"]):
        return False
    if vehicle_matches_any(vehicle, item["exclude"]):
        return False
    return True


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
