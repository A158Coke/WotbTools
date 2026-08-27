#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 BlitzKit skills.pb 生成 common/crew-skills.json。

数据边界：BlitzKit 的 SkillDefinitions 只提供 TankClass -> canonical skill id 列表。
本脚本因此只落档可验证的结构化事实，不猜测技能显示名、描述或效果数值。

用法：
    python common/python/update_crew_skills.py
    python common/python/update_crew_skills.py --output /tmp/crew-skills.json
"""

import argparse
import json
import os
import re
import struct
import urllib.request
from datetime import datetime, timezone

PB_URL = "https://assets.blitzkit.app/definitions/skills.pb"
ICON_BASE_URL = "https://api.blitzkit.app/icons/skills"
REPO_COMMON_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "common",
)
DEFAULT_OUTPUT = os.path.join(REPO_COMMON_DIR, "crew-skills.json")

CLASS_META = {
    0: ("light", "Light tank"),
    1: ("medium", "Medium tank"),
    2: ("heavy", "Heavy tank"),
    3: ("tank_destroyer", "Tank destroyer"),
}
EXPECTED_CLASS_IDS = set(CLASS_META)
MIN_SKILLS_PER_CLASS = 4
SKILL_ID_RE = re.compile(r"^[a-z0-9_]+$")


def _read_varint(buf, i):
    shift = 0
    result = 0
    while True:
        if i >= len(buf):
            raise ValueError("truncated varint")
        byte = buf[i]
        i += 1
        result |= (byte & 0x7F) << shift
        if not (byte & 0x80):
            return result, i
        shift += 7
        if shift >= 64:
            raise ValueError("invalid varint")


def decode_protobuf(buf):
    """最小 protobuf wire decoder，返回 {field_number: [values]}。"""
    fields = {}
    i = 0
    while i < len(buf):
        tag, i = _read_varint(buf, i)
        field = tag >> 3
        wire_type = tag & 7
        if field == 0:
            raise ValueError("invalid protobuf field 0")
        if wire_type == 0:
            value, i = _read_varint(buf, i)
        elif wire_type == 1:
            if i + 8 > len(buf):
                raise ValueError("truncated fixed64")
            value = struct.unpack("<Q", buf[i:i + 8])[0]
            i += 8
        elif wire_type == 2:
            length, i = _read_varint(buf, i)
            if i + length > len(buf):
                raise ValueError("truncated length-delimited field")
            value = buf[i:i + length]
            i += length
        elif wire_type == 5:
            if i + 4 > len(buf):
                raise ValueError("truncated fixed32")
            value = struct.unpack("<I", buf[i:i + 4])[0]
            i += 4
        else:
            raise ValueError(f"unsupported protobuf wire type: {wire_type}")
        fields.setdefault(field, []).append(value)
    return fields


def _first(fields, field, default=None):
    values = fields.get(field)
    return values[0] if values else default


def parse_skill_definitions(data):
    """解析 BlitzKit SkillDefinitions.proto: map<uint32, Skill> classes = 1。"""
    root = decode_protobuf(data)
    result = {}
    for raw_entry in root.get(1, []):
        entry = decode_protobuf(raw_entry)
        class_id = _first(entry, 1)
        raw_skill = _first(entry, 2)
        if not isinstance(class_id, int) or not isinstance(raw_skill, (bytes, bytearray)):
            raise ValueError("malformed SkillDefinitions classes entry")
        skill_message = decode_protobuf(raw_skill)
        skills = [raw.decode("utf-8") for raw in skill_message.get(1, [])]
        result[class_id] = skills
    return result


def validate(classes):
    class_ids = set(classes)
    if class_ids != EXPECTED_CLASS_IDS:
        raise ValueError(
            f"unexpected tank classes: got={sorted(class_ids)} expected={sorted(EXPECTED_CLASS_IDS)}"
        )

    all_skills = []
    for class_id in sorted(classes):
        skills = classes[class_id]
        if len(skills) < MIN_SKILLS_PER_CLASS:
            raise ValueError(
                f"class {class_id} has only {len(skills)} skills; refusing suspicious snapshot"
            )
        if len(skills) != len(set(skills)):
            raise ValueError(f"duplicate skill id inside class {class_id}")
        for skill_id in skills:
            if not SKILL_ID_RE.fullmatch(skill_id):
                raise ValueError(f"invalid skill id: {skill_id!r}")
        all_skills.extend(skills)

    if len(all_skills) != len(set(all_skills)):
        raise ValueError("same skill id appears in multiple tank classes")


def build_document(classes):
    validate(classes)
    class_documents = {}
    total = 0
    for class_id in sorted(classes):
        key, name = CLASS_META[class_id]
        skills = [
            {
                "id": skill_id,
                "icon": f"{ICON_BASE_URL}/{skill_id}.webp",
            }
            for skill_id in classes[class_id]
        ]
        total += len(skills)
        class_documents[key] = {
            "classId": class_id,
            "name": name,
            "skills": skills,
        }

    return {
        "meta": {
            "source": PB_URL,
            "sourceProject": "blitzkit/blitzkit",
            "generatedAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "count": total,
        },
        "classes": class_documents,
    }


def fetch_bytes(url):
    request = urllib.request.Request(url, headers={"User-Agent": "WotBTools-data-sync/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    data = fetch_bytes(PB_URL)
    document = build_document(parse_skill_definitions(data))
    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(document, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(
        "crew skills updated: classes=%d skills=%d output=%s"
        % (len(document["classes"]), document["meta"]["count"], args.output)
    )


if __name__ == "__main__":
    main()
