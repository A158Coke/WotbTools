#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Generate common/crew-skills.json from stable BlitzKit skill definitions.

BlitzKit currently exposes canonical TankClass -> skill id[] membership. This
sync records only those structured facts plus derived icon URLs; it deliberately
does not invent display names, descriptions, or effect values.
"""

import argparse
import json
import os
import re
import struct
import urllib.request
from datetime import datetime, timezone

from blitzkit_snapshot import GAME_URL, fetch_stable_snapshot, parse_game_version

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
    """Minimal protobuf wire decoder returning {field_number: [values]}."""
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


def _as_str(value):
    if isinstance(value, bytes):
        return value.decode("utf-8")
    return str(value) if value is not None else ""


def parse_skill_definitions(data):
    """Parse SkillDefinitions.proto: map<uint32, Skill> classes = 1."""
    root = decode_protobuf(data)
    result = {}
    for raw_entry in root.get(1, []):
        entry = decode_protobuf(raw_entry)
        class_id = _first(entry, 1)
        raw_skill = _first(entry, 2)
        if not isinstance(class_id, int) or not isinstance(raw_skill, (bytes, bytearray)):
            raise ValueError("malformed SkillDefinitions classes entry")
        if class_id in result:
            raise ValueError(f"duplicate tank class entry: {class_id}")
        skill_message = decode_protobuf(raw_skill)
        try:
            skills = [raw.decode("utf-8") for raw in skill_message.get(1, [])]
        except UnicodeDecodeError as error:
            raise ValueError("invalid UTF-8 skill id") from error
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


def build_classes_document(classes):
    validate(classes)
    result = {}
    for class_id in sorted(classes):
        key, name = CLASS_META[class_id]
        result[key] = {
            "classId": class_id,
            "name": name,
            "skills": [
                {
                    "id": skill_id,
                    "icon": f"{ICON_BASE_URL}/{skill_id}.webp",
                }
                for skill_id in classes[class_id]
            ],
        }
    return result


def build_document(classes, game_version=None, skills_hash=None, generated_at=None):
    class_documents = build_classes_document(classes)
    meta = {
        "source": PB_URL,
        "sourceProject": "blitzkit/blitzkit",
        "generatedAt": generated_at or datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "count": sum(len(value["skills"]) for value in class_documents.values()),
    }
    if game_version:
        meta["sourceGameVersion"] = game_version
    if skills_hash:
        meta["sourceHash"] = skills_hash
    return {"meta": meta, "classes": class_documents}


def reconcile_document(existing, classes, game_version, skills_hash, generated_at=None):
    """Return (document, changed), avoiding timestamp-only/update-metadata-only PRs."""
    class_documents = build_classes_document(classes)
    existing_meta = (existing or {}).get("meta") or {}
    existing_classes = (existing or {}).get("classes")

    # Once trace metadata exists, identical skill semantics are a true no-op even
    # when game.pb or protobuf serialization changes independently of skill data.
    if (
        existing_classes == class_documents
        and existing_meta.get("sourceHash")
        and existing_meta.get("sourceGameVersion")
    ):
        return existing, False

    return build_document(
        classes,
        game_version=game_version,
        skills_hash=skills_hash,
        generated_at=generated_at,
    ), True


def fetch_bytes(url):
    request = urllib.request.Request(url, headers={"User-Agent": "WotBTools-data-sync/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.read()


def load_existing(path):
    if not path or not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default=DEFAULT_OUTPUT)
    parser.add_argument("--existing", default=None)
    args = parser.parse_args(argv)

    snapshots, hashes = fetch_stable_snapshot(
        {"game": GAME_URL, "skills": PB_URL},
        fetch_bytes,
    )
    game_version = parse_game_version(
        snapshots["game"], decode_protobuf, _first, _as_str
    )
    classes = parse_skill_definitions(snapshots["skills"])
    existing_path = args.existing or (args.output if os.path.exists(args.output) else None)
    document, changed = reconcile_document(
        load_existing(existing_path),
        classes,
        game_version,
        hashes["skills"],
    )

    if not changed and os.path.abspath(args.output) == os.path.abspath(existing_path):
        print(
            "crew skills unchanged: game_version=%s skills=%d hash=%s"
            % (game_version, document["meta"]["count"], hashes["skills"][:12])
        )
        return 0

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(document, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print(
        "crew skills %s: game_version=%s classes=%d skills=%d hash=%s output=%s"
        % (
            "updated" if changed else "unchanged",
            game_version,
            len(document["classes"]),
            document["meta"]["count"],
            hashes["skills"][:12],
            args.output,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
