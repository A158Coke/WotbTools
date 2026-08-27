#!/usr/bin/env python3
"""Generate Tankopedia from one stable BlitzKit definition set."""

import argparse
import os
import sys
import urllib.request
from datetime import datetime, timezone

import update_tankopedia as ut
from blitzkit_snapshot import GAME_URL, fetch_stable_snapshot, parse_game_version
from validate_tankopedia_equipment import validate_vehicle_equipment_coverage


def fetch_bytes(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()


def validate_item_catalog_coverage(vehicles, item_defs, item_map, kind):
    """Reject applicable upstream items that the local catalog would silently omit."""
    missing = []
    for item in item_defs:
        item_id = item["id"]
        if item_id in item_map:
            continue
        vehicle_ids = sorted(
            vehicle.get("id")
            for vehicle in vehicles.values()
            if ut.item_allowed(vehicle, item)
        )
        if vehicle_ids:
            missing.append((item_id, item.get("name"), vehicle_ids[:10]))

    if missing:
        details = ", ".join(
            "id=%s name=%r vehicles=%s" % (item_id, name, vehicle_ids)
            for item_id, name, vehicle_ids in missing[:20]
        )
        raise RuntimeError("TANKOPEDIA_UNKNOWN_%s_ID: %s" % (kind.upper(), details))
    return True


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--existing-dir", default=ut.REPO_COMMON_DIR)
    parser.add_argument("--output-dir", default=ut.REPO_COMMON_DIR)
    args = parser.parse_args(argv)

    resources = {
        "game": GAME_URL,
        "tanks": ut.PB_URL,
        "consumables": ut.CONSUMABLES_URL,
        "provisions": ut.PROVISIONS_URL,
        "equipment": ut.EQUIPMENT_URL,
    }
    snapshots, hashes = fetch_stable_snapshot(resources, fetch_bytes)
    game_version = parse_game_version(
        snapshots["game"], ut.decode_protobuf, ut.f1, ut.as_str
    )
    print(
        "stable snapshot: game_version=%s %s"
        % (
            game_version,
            " ".join("%s=%s" % (name, hashes[name][:12]) for name in sorted(hashes)),
        )
    )

    old_data = ut.load_existing_data_dir(args.existing_dir)
    vehicles = ut.filter_to_business_tiers(ut.parse_tanks(snapshots["tanks"]))
    total = len(vehicles)

    provision_map, consumable_map = ut.load_catalog()
    provision_defs = ut.parse_item_defs(snapshots["provisions"])
    consumable_defs = ut.parse_item_defs(snapshots["consumables"])
    validate_item_catalog_coverage(vehicles, provision_defs, provision_map, "provision")
    validate_item_catalog_coverage(vehicles, consumable_defs, consumable_map, "consumable")
    vehicles = ut.apply_items(
        vehicles,
        provision_defs,
        consumable_defs,
        provision_map,
        consumable_map,
    )

    equipment_presets, _ = ut.parse_equipment_defs(snapshots["equipment"])
    equipment_map = ut.load_equipment_catalog()
    validate_vehicle_equipment_coverage(vehicles, equipment_presets, equipment_map)
    vehicles = ut.apply_equipment(vehicles, equipment_presets, equipment_map)
    vehicles = ut.merge_extra_info(vehicles, old_data)

    try:
        ut.validate_integrity(vehicles, old_data)
    except RuntimeError as error:
        print("ERROR: %s" % error, file=sys.stderr)
        return 1

    generated_at = datetime.now(timezone.utc).isoformat()
    new_data = {}
    per_tier = {}
    os.makedirs(args.output_dir, exist_ok=True)
    for tier in sorted(ut.TIER_FILES):
        tier_vehicles = [
            ut.vehicle_output(vehicles[key])
            for key in sorted(vehicles, key=lambda key: int(key))
            if vehicles[key].get("tier") == tier
        ]
        per_tier[tier] = tier_vehicles
        for vehicle in tier_vehicles:
            new_data[str(vehicle["id"])] = vehicle
        ut.write_json(os.path.join(args.output_dir, ut.TIER_FILES[tier]), {
            "meta": {
                "source": "blitzkit stable definitions",
                "source_game_version": game_version,
                "source_hashes": hashes,
                "tier": tier,
                "generated_at": generated_at,
                "count": len(tier_vehicles),
            },
            "vehicles": tier_vehicles,
        })

    ok, old_knowledge, preserved_knowledge = ut.verify_knowledge_preservation(old_data, new_data)
    if not ok:
        print("ERROR: extraInfo preservation failed.", file=sys.stderr)
        return 1
    print(
        "SAFE_RESULTS game_version=%s snapshot_vehicles=%d %s existing_knowledge=%d preserved_knowledge=%d"
        % (
            game_version,
            total,
            " ".join("tier%d=%d" % (tier, len(per_tier[tier])) for tier in sorted(per_tier)),
            old_knowledge,
            preserved_knowledge,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
