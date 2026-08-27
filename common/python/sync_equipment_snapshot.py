#!/usr/bin/env python3
"""Sync equipment from one stable BlitzKit definition set plus reviewed source locks."""

import argparse
import json

import update_equipment as ue
from blitzkit_snapshot import GAME_URL, fetch_stable_snapshot, parse_game_version
from validate_locked_equipment_contract import (
    validate_locked_contract_from_pb,
    validate_reviewed_equipment_snapshot,
    validate_reviewed_game_version,
)


def validate_structural_catalog_contract(payload, equipment_pb, tanks_pb):
    """Validate IDs/names/coverage without inventing one universal preset grid.

    BlitzKit special vehicle presets legitimately substitute equipment at raw preset
    indexes, so raw index is not a canonical catalog coordinate. Preset/layout drift is
    guarded by the reviewed full equipment.pb fingerprint instead.
    """
    presets, equipment_names = ue.parse_equipment_defs(equipment_pb)
    vehicles = ue.filter_to_business_tiers(ue.parse_tanks(tanks_pb))
    _, required_ids = ue.required_business_equipment_ids(vehicles, presets)

    catalog_by_id = {item["id"]: item for item in payload["items"]}
    missing = sorted(required_ids - set(catalog_by_id))
    if missing:
        rendered = [f"{item_id}:{equipment_names.get(item_id, '?')}" for item_id in missing]
        raise RuntimeError("BLITZKIT_NEW_BUSINESS_EQUIPMENT: " + ", ".join(rendered))

    for item in payload["items"]:
        equipment_id = item["id"]
        upstream_name = equipment_names.get(equipment_id)
        if upstream_name is None:
            raise RuntimeError("BLITZKIT_EQUIPMENT_REMOVED: %s id=%s" % (item["code"], equipment_id))
        if upstream_name != item.get("nameEn"):
            raise RuntimeError(
                "BLITZKIT_EQUIPMENT_RENAMED: %s catalog=%r upstream=%r"
                % (item["code"], item.get("nameEn"), upstream_name)
            )

    codes = {item["code"] for item in payload["items"]}
    modeled = ue.FULLY_MODELED_CODES | ue.LOCKED_CODES
    if codes != modeled:
        raise RuntimeError(
            "CATALOG_MODEL_COVERAGE_MISMATCH: missing_models=%s stale_models=%s"
            % (sorted(codes - modeled), sorted(modeled - codes))
        )
    return True


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", default="common/wotb-item-catalog-json/equipment.json")
    args = parser.parse_args(argv)

    with open(args.catalog, encoding="utf-8") as file:
        payload = json.load(file)

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
    validate_reviewed_game_version(game_version)

    equipment_pb = snapshots["equipment"]
    tanks_pb = snapshots["tanks"]
    validate_reviewed_equipment_snapshot(equipment_pb)

    print(
        "stable reviewed equipment snapshot: game_version=%s %s"
        % (
            game_version,
            " ".join("%s=%s" % (name, hashes[name][:12]) for name in sorted(hashes)),
        )
    )

    validate_structural_catalog_contract(payload, equipment_pb, tanks_pb)
    validate_locked_contract_from_pb(payload, equipment_pb)

    sources = {
        name: ue.fetch_reviewed_source(path, sha)
        for name, (path, sha) in ue.SOURCE_FILES.items()
    }
    ue.sync_values(
        payload,
        sources["characteristics"],
        sources["penetration"],
        sources["armor"],
    )
    ue.validate(payload)

    with open(args.catalog, "w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
