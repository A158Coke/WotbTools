"""Vehicle field parsing and business-tier projection."""
from _tankopedia_config import (
    CLASS_TO_EN, FIELD_ENGINE_POWER, FIELD_ENGINE_TIER, FIELD_GUN_ID,
    FIELD_GUN_SHELLS, FIELD_GUN_TIER, FIELD_PEN_VALUE, FIELD_SHELL_DAMAGE,
    FIELD_SHELL_PEN, FIELD_SHELL_TYPE, FIELD_TANK_CLASS, FIELD_TANK_DATA,
    FIELD_TANK_ENGINES, FIELD_TANK_EQUIPMENT_PRESET, FIELD_TANK_HULL_HP,
    FIELD_TANK_ID, FIELD_TANK_NAME, FIELD_TANK_NATION, FIELD_TANK_SPEED_BACKWARD,
    FIELD_TANK_SPEED_FORWARD, FIELD_TANK_TIER, FIELD_TANK_TRACKS,
    FIELD_TANK_TURRETS, FIELD_TANK_WEIGHT, FIELD_TRACK_TIER, FIELD_TRACK_TRAVERSE,
    FIELD_TURRET_GUN, FIELD_TURRET_HP, FIELD_TURRET_TIER, FIELD_TURRET_TRAVERSE,
    MODELED_ITEM_TIERS, NATION_TO_EN, SHELL_TYPE_NORM,
)
from _tankopedia_proto import as_int, as_str, decode_protobuf, f1, f32


def filter_to_business_tiers(vehicles):
    """保留现有物资/装备建模范围（7–10 级），与基础车型资料覆盖范围独立。"""
    return {
        tank_id: entry for tank_id, entry in vehicles.items()
        if isinstance(entry, dict) and entry.get("tier") in MODELED_ITEM_TIERS
    }


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
        # - 1-9 级：顶配炮 = 最高 tier，同 tier 取最高 alpha（T-34-2 取 122mm 400，
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
