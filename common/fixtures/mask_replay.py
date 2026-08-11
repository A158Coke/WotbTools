#!/usr/bin/env python3
"""脱敏 .wotbreplay 夹具：按 UTF-8 字节长度等价替换昵称/军团名，账号 ID 保留。

用法:
    python mask_replay.py --input <原始.wotbreplay> --output <脱敏.wotbreplay>

规则:
  - 昵称/军团名/meta.playerName 中每个字符替换为同字节长度的占位符:
    1 字节(ASCII) -> 'x'; 2 字节 -> '©'; 3 字节(CJK) -> '隐'; 4 字节 -> '😀'
  - 账号 ID(accountId/dbid) 保留，便于解析断言。
  - 重新打包 zip（保留条目名与顺序），并自校验: 解析结果结构一致、原昵称字节不再出现。
"""

import argparse
import json
import sys
import zipfile
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except (AttributeError, ValueError):
    pass

MARK = object()


def loads_pickle(data: bytes):
    stack, memo, pos = [], {}, 0

    def u1():
        nonlocal pos
        b = data[pos]
        pos += 1
        return b

    def le(k):
        nonlocal pos
        b = data[pos:pos + k]
        pos += k
        return int.from_bytes(b, "little")

    def s4():
        nonlocal pos
        b = data[pos:pos + 4]
        pos += 4
        return int.from_bytes(b, "little", signed=True)

    def sbytes(k):
        nonlocal pos
        b = data[pos:pos + k]
        pos += k
        return bytes(b)

    def push(v):
        stack.append(v)

    while pos < len(data):
        op = u1()
        if op == 0x80:
            u1()
        elif op == 0x95:
            pos += 8
        elif op == 0x28:
            push(MARK)
        elif op == 0x4E:
            push(None)
        elif op == 0x88:
            push(True)
        elif op == 0x89:
            push(False)
        elif op == 0x4B:
            push(u1())
        elif op == 0x4D:
            push(le(2))
        elif op == 0x4A:
            push(s4())
        elif op == 0x8A:
            push(int.from_bytes(sbytes(u1()), "little", signed=True))
        elif op == 0x8B:
            push(int.from_bytes(sbytes(s4()), "little", signed=True))
        elif op == 0x54:
            push(sbytes(le(4)))
        elif op == 0x55:
            push(sbytes(u1()))
        elif op == 0x42:
            push(sbytes(le(4)))
        elif op == 0x43:
            push(sbytes(u1()))
        elif op == 0x8E:
            push(sbytes(le(8)))
        elif op == 0x58:
            push(sbytes(le(4)).decode("utf-8"))
        elif op == 0x8C:
            push(sbytes(u1()).decode("utf-8"))
        elif op == 0x8D:
            push(sbytes(le(8)).decode("utf-8"))
        elif op == 0x29:
            push(())
        elif op == 0x85:
            stack[-1:] = [tuple(stack[-1:])]
        elif op == 0x86:
            a = stack.pop()
            b = stack.pop()
            push((b, a))
        elif op == 0x87:
            a = stack.pop()
            b = stack.pop()
            c = stack.pop()
            push((c, b, a))
        elif op == 0x74:
            idx = len(stack) - 1 - stack[::-1].index(MARK)
            t = tuple(stack[idx + 1:])
            del stack[idx:]
            push(t)
        elif op == 0x5D:
            push([])
        elif op == 0x7D:
            push({})
        elif op == 0x71:
            memo[u1()] = stack[-1]
        elif op == 0x72:
            memo[le(4)] = stack[-1]
        elif op == 0x94:
            memo[len(memo)] = stack[-1]
        elif op == 0x68:
            push(memo[u1()])
        elif op == 0x6A:
            push(memo[le(4)])
        elif op == 0x61:
            v = stack.pop()
            stack[-1].append(v)
        elif op == 0x65:
            idx = len(stack) - 1 - stack[::-1].index(MARK)
            stack[idx - 1].extend(stack[idx + 1:])
            del stack[idx:]
        elif op == 0x73:
            v = stack.pop()
            k = stack.pop()
            stack[-1][k] = v
        elif op == 0x75:
            idx = len(stack) - 1 - stack[::-1].index(MARK)
            d = stack[idx - 1]
            for i in range(idx + 1, len(stack), 2):
                d[stack[i]] = stack[i + 1]
            del stack[idx:]
        elif op == 0x2E:
            return stack[-1]
        else:
            raise ValueError(f"opcode {op:#x} at {pos - 1}")
    raise ValueError("no STOP")


def decode_pb(buf: bytes):
    fields, i = {}, 0

    def varint():
        nonlocal i
        res = 0
        for shift in range(0, 70, 7):
            b = buf[i]
            i += 1
            res |= (b & 0x7F) << shift
            if not (b & 0x80):
                return res
        raise ValueError("varint overflow")

    while i < len(buf):
        tag = varint()
        fnum, wt = tag >> 3, tag & 7
        if wt == 0:
            v = varint()
        elif wt == 1:
            v = int.from_bytes(buf[i:i + 8], "little", signed=True)
            i += 8
        elif wt == 2:
            ln = varint()
            v = bytes(buf[i:i + ln])
            i += ln
        elif wt == 5:
            v = int.from_bytes(buf[i:i + 4], "little", signed=True)
            i += 4
        else:
            raise ValueError(f"wire {wt}")
        fields.setdefault(fnum, []).append(v)
    return fields


def f1(f, num):
    return f.get(num, [None])[0]


def msg(f, num):
    v = f1(f, num)
    return decode_pb(v) if isinstance(v, (bytes, bytearray)) else {}


def text(f, num):
    v = f1(f, num)
    if isinstance(v, (bytes, bytearray)):
        return v.decode("utf-8")
    return "" if v is None else str(v)


def roster_from_results(dat: bytes):
    """从 battle_results.dat 提取昵称与军团名（不含账号，账号保留）。"""
    obj = loads_pickle(dat)
    root = decode_pb(obj[1])
    roster = {}
    for raw in root.get(201, []):
        p = decode_pb(raw)
        acc = f1(p, 1)
        info = msg(p, 2)
        roster[acc] = (text(info, 1), text(info, 5))
    return list(roster.values())


def placeholder(name: str) -> str:
    out = []
    for ch in name:
        n = len(ch.encode("utf-8"))
        out.append({1: "x", 2: "©", 3: "隐", 4: "😀"}[n])
    return "".join(out)


def mask_bytes(data: bytes, mapping):
    for original, masked in mapping:
        if original == masked:
            continue
        orig_b = original.encode("utf-8")
        masked_b = masked.encode("utf-8")
        assert len(orig_b) == len(masked_b), f"byte length mismatch: {original!r}"
        if orig_b in data:
            data = data.replace(orig_b, masked_b)
    return data


def main():
    parser = argparse.ArgumentParser(description="脱敏 .wotbreplay 夹具")
    parser.add_argument("--input", required=True, help="原始 .wotbreplay 路径")
    parser.add_argument("--output", required=True, help="脱敏 .wotbreplay 输出路径")
    args = parser.parse_args()

    src = Path(args.input)
    dst = Path(args.output)
    dst.parent.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(src) as zin:
        entries = [(i.filename, zin.read(i.filename)) for i in zin.infolist()]

    dat = dict(entries).get("battle_results.dat", b"")
    if not dat:
        sys.exit("battle_results.dat 缺失，无法提取昵称")
    pairs = roster_from_results(dat)
    names = {n for n, _ in pairs if n} | {c for _, c in pairs if c}
    mapping = [(n, placeholder(n)) for n in sorted(names, key=len, reverse=True)]

    masked_entries = []
    for name, content in entries:
        out = mask_bytes(content, mapping)
        if name == "meta.json":
            try:
                meta = json.loads(out.decode("utf-8"))
                if meta.get("playerName"):
                    meta["playerName"] = placeholder(meta["playerName"])
                out = json.dumps(meta, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            except (ValueError, UnicodeDecodeError):
                out = mask_bytes(out, mapping)
        masked_entries.append((name, out))

    with zipfile.ZipFile(dst, "w", zipfile.ZIP_DEFLATED) as zout:
        for name, content in masked_entries:
            zout.writestr(name, content)

    # 自校验 1：原昵称/军团名字节不再出现在输出任何条目
    leftovers = []
    with zipfile.ZipFile(dst) as z:
        for name in z.namelist():
            content = z.read(name)
            for original, _ in mapping:
                if original.encode("utf-8") in content:
                    leftovers.append((name, original))
    if leftovers:
        sys.exit(f"脱敏残留: {leftovers}")

    # 自校验 2：解析结构一致（arena/队伍/战绩/死亡时刻 与原始相同）
    before = roster_from_results(dat)
    with zipfile.ZipFile(dst) as z:
        after_dat = z.read("battle_results.dat")
    after = roster_from_results(after_dat)
    if len(before) != len(after):
        sys.exit(f"名册数量变化: {len(before)} -> {len(after)}")
    if any(a == b for (a, _), (b, _) in zip(before, after)):
        sys.exit("存在未脱敏的昵称")
    print(f"OK: {len(mapping)} 个名称已脱敏, {len(masked_entries)} 个条目, 输出 {dst}")


if __name__ == "__main__":
    main()
