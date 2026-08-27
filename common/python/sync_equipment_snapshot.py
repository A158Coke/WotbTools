#!/usr/bin/env python3
"""Sync equipment from one stable BlitzKit definition set.

The updater is forward-compatible by design: new game versions and changed
protobuf snapshots are allowed to flow through when the existing parsers can
fully understand them. Only unsupported/new equipment models or changes to
partially modeled locked items fail closed.
"""

import argparse
import copy
import json

import update_equipment as ue
from blitzkit_snapshot import GAME_URL, fetch_stable_snapshot, parse_game_version
from validate_locked_equipment_contract import (
    locked_definition_hashes,
    validate_locked_contract_from_pb,
)


CLASS_ORDER = {"LIGHT": 0, "MEDIUM": 1, "HEAVY": 2, "TANK_DESTROYER": 3}


def stabilize_generated_effect_order(payload):
    """Keep generated camouflage effects in the catalog's canonical order."""
    item = ue.item_by_code(payload, "CAMOUFLAGE_NET")

    def key(effect):
        conditions = effect.get("conditions") or {}
        classes = conditions.get("vehicleClasses") or []
        vehicle_class = classes[0] if classes else ""
        stationary = 1 if "stationarySecondsAtLeast" in conditions else 0
        return stationary, CLASS_ORDER.get(vehicle_class, 99)

    item["effects"].sort(key=key)
    return payload


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", default="common/wotb-item-catalog-json/equipment.json")
    args = parser.parse_args(argv)

    with open(args.catalog, encoding="utf-8") as file:
        payload = json.load(file)
    original_payload = copy.deepcopy(payload)

    resources = {
        "game": GAME_URL,
        "equipment": ue.EQUIPMENT_URL,
        "tanks": ue.PB_URL,
    }
    snapshots, hashes = fetch_stable_snapshot(
        resources,
        lambda url: ue.fetch(url, binary=True),
    )
    game_version = parse_game_version(
        snapshots["game"], ue.decode_protobuf, ue.f1, ue.as_str
    )

    equipment_pb = snapshots["equipment"]
    tanks_pb = snapshots["tanks"]
    print(
        "stable equipment snapshot: game_version=%s %s"
        % (
            game_version,
            " ".join("%s=%s" % (name, hashes[name][:12]) for name in sorted(hashes)),
        )
    )

    ue.sync_upstream_metadata(payload, equipment_pb, tanks_pb)

    # Locked equipment needs a narrower guard than a whole-file fingerprint.
    # Log each complete definition hash so reviewed item-level locks can be updated
    # without blocking unrelated new vehicles, presets, equipment, or game builds.
    for code, definition_hash in sorted(locked_definition_hashes(payload, equipment_pb).items()):
        print("locked_definition_sha256 %s=%s" % (code, definition_hash))

    validate_locked_contract_from_pb(payload, equipment_pb)

    sources = {
        name: ue.fetch_source(path)
        for name, path in ue.SOURCE_FILES.items()
    }
    ue.sync_values(
        payload,
        sources["characteristics"],
        sources["penetration"],
        sources["armor"],
    )
    stabilize_generated_effect_order(payload)
    ue.validate(payload)

    if payload == original_payload:
        print("equipment catalog already matches current supported upstream data")
        return 0

    with open(args.catalog, "w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
