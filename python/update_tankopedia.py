#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 blitzkit 拉取最新车辆库 (tanks.pb) 并转换为本工具用的 tankopedia.json。
游戏出新车后运行本脚本, 再执行 build.bat 重建 exe 即可。

    python update_tankopedia.py
"""
import json
import os
import urllib.request

from wotb_extractor import decode_protobuf, as_str, f1

URL = "https://assets.blitzkit.app/definitions/tanks.pb"
CLASS = {0: "轻坦", 1: "中坦", 2: "重坦", 3: "TD"}
NATION = {
    "ussr": "苏联", "germany": "德国", "usa": "美国", "china": "中国",
    "france": "法国", "uk": "英国", "japan": "日本", "european": "欧洲", "other": "其他",
}


def i18n_en(raw):
    """从 I18nString(map<string,string>) 取英文名, 没有则取第一个。"""
    best = None
    for e in decode_protobuf(raw).get(1, []):
        kv = decode_protobuf(e)
        loc = as_str(f1(kv, 1, b""))
        val = as_str(f1(kv, 2, b""))
        if loc == "en":
            return val
        if best is None:
            best = val
    return best


def main():
    print(f"下载 {URL} ...")
    raw = urllib.request.urlopen(URL, timeout=60).read()
    entries = decode_protobuf(raw).get(1, [])
    data = {}
    for e in entries:
        kv = decode_protobuf(e)
        tank_id = f1(kv, 1)
        td = decode_protobuf(f1(kv, 2, b""))
        nation = as_str(f1(td, 11, b""))
        data[str(tank_id)] = {
            "name": i18n_en(f1(td, 12, b"")),
            "tier": f1(td, 16),
            # 注意: protobuf 默认值 0 不序列化, 轻坦(TankClass=0)的 #17 字段会缺失,
            # 因此缺失时按轻坦(0)处理。
            "class": CLASS.get(f1(td, 17, 0), ""),
            "nation": NATION.get(nation, nation),
            "premium": (f1(td, 13) == 1),
        }
    obj = {
        "meta": {
            "count": len(data),
            "source": "blitzkit (assets.blitzkit.app/definitions/tanks.pb)",
        },
        "data": data,
    }
    # 车辆库是 Python 与 Java 两侧共用的单一来源, 写到仓库的 common/tankopedia.json。
    here = os.path.dirname(os.path.abspath(__file__))
    out_path = os.path.normpath(os.path.join(here, "..", "common", "tankopedia.json"))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fp:
        json.dump(obj, fp, ensure_ascii=False, separators=(",", ":"))
    print(f"已写入 {out_path}: {len(data)} 辆车")


if __name__ == "__main__":
    main()
