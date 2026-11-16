"""Small schema-less protobuf primitives shared by Tankopedia tools."""
import struct


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
