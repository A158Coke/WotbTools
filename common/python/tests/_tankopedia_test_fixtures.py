"""Small protobuf and catalog fixtures shared by Tankopedia unit tests."""
import struct

def encode_varint(value):
    out = bytearray()
    while True:
        b = value & 0x7F
        value >>= 7
        if value:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)

def key(field, wt):
    return encode_varint((field << 3) | wt)

def f_bytes(field, data):
    return key(field, 2) + encode_varint(len(data)) + bytes(data)

def f_varint(field, value):
    return key(field, 0) + encode_varint(value)

def f_float(field, value):
    return key(field, 5) + struct.pack("<f", value)

def i18n(entries):
    """I18nString: entries=[(locale, value)]"""
    out = b""
    for loc, val in entries:
        out += f_bytes(1, f_bytes(1, loc.encode()) + f_bytes(2, val.encode()))
    return out

def shell(shell_type, damage, pen):
    pen_msg = f_float(1, float(pen)) + f_float(2, float(pen))
    return (f_bytes(7, shell_type.encode()) + f_varint(4, damage) + f_bytes(8, pen_msg))

def gun(gun_id, shells, clip=False, tier=10):
    out = f_varint(4, gun_id)
    out += f_varint(9, tier)
    out += f_bytes(2 if clip else 1, b"")
    for s in shells:
        out += f_bytes(10, s)
    return out

def turret(turret_hp, *gun_msgs, traverse=42.0, tier=10):
    out = f_varint(2, turret_hp) + f_varint(7, tier) + f_float(4, float(traverse))
    for gun_msg in gun_msgs:
        out += f_bytes(9, gun_msg)
    return out

def tank_data(tank_id, tier, tank_class, hull_hp, turret_msg, name="T-34",
              nation="ussr", speed_fwd=56, speed_bwd=20, weight=10000,
              engine_power=400, engine_tier=10, track_traverse=46.0, track_tier=10,
              equipment_preset="defaultPreset"):
    td = b""
    td += f_varint(16, tier)
    td += f_varint(17, tank_class)
    td += f_varint(10, hull_hp)
    td += f_bytes(11, nation.encode())
    td += f_bytes(12, i18n([("en", name), ("ru", "тест")]))
    td += f_bytes(20, turret_msg)
    td += f_bytes(21, f_varint(4, engine_tier) + f_varint(6, engine_power))
    td += f_bytes(22, f_varint(2, track_tier) + f_float(5, float(track_traverse)))
    td += f_float(25, float(speed_fwd))
    td += f_float(26, float(speed_bwd))
    td += f_varint(31, weight)
    td += f_bytes(30, equipment_preset.encode())
    entry = f_varint(1, tank_id) + f_bytes(2, td)
    return f_bytes(1, entry)

def root(*tanks):
    return b"".join(tanks)

def filter_tiers(lo, hi):
    inner = f_varint(1, lo) + f_varint(2, hi)
    return f_bytes(1, inner)

def filter_ids(ids):
    inner = b"".join(f_varint(1, i) for i in ids)
    return f_bytes(2, inner)

def filter_categories(categories):
    inner = b"".join(f_varint(1, c) for c in categories)
    return f_bytes(3, inner)

def filter_nations(nations):
    inner = b"".join(f_bytes(1, n.encode()) for n in nations)
    return f_bytes(4, inner)

def item_def(item_id, name, include=None, exclude=None):
    """Consumable/Provision map 条目。include/exclude=[(filter_bytes, ...)]。"""
    msg = f_bytes(2, i18n([("en", name)]))
    for flt in include or []:
        msg += f_bytes(6, flt)
    for flt in exclude or []:
        msg += f_bytes(7, flt)
    return f_bytes(1, f_varint(1, item_id) + f_bytes(2, msg))

def item_root(*items):
    return b"".join(items)

def equipment_preset(name, slots):
    slots_msg = b"".join(f_bytes(1, f_varint(1, left) + f_varint(2, right))
                         for left, right in slots)
    return f_bytes(1, f_bytes(1, name.encode()) + f_bytes(2, slots_msg))

def equipment_item(equipment_id, name):
    return f_bytes(2, f_varint(1, equipment_id) + f_bytes(2, i18n([("en", name)])))

def equipment_root(*entries):
    return b"".join(entries)
