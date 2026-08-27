#!/usr/bin/env python3
"""Generate Tankopedia from one BlitzKit snapshot and validate that exact snapshot."""

import argparse
import os
import sys
import urllib.request
from datetime import datetime, timezone

import update_tankopedia as ut
from validate_tankopedia_equipment import validate_vehicle_equipment_coverage


def fetch_bytes(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--existing-dir", default=ut.REPO_COMMON_DIR)
    parser.add_argument("--output-dir", default=ut.REPO_COMMON_DIR)
    args = parser.parse_args(argv)

    snapshots = {
        "tanks": fetch_bytes(ut.PB_URL),
        "consumables": fetch_bytes(ut.CONSUMABLES_URL),
        "provisions": fetch_bytes(ut.PROVISIONS_URL),
        "equipment": fetch_bytes(ut.EQUIPMENT_URL),
    }
    print(
        "snapshot bytes: tanks=%d consumables=%d provisions=%d equipment=%d"
        % tuple(len(snapshots[key]) for key in ("tanks", "consumables", "provisions", "equipment"))
    )

    old_data = ut.load_existing_data_dir(args.existing_dir)
    vehicles = ut.filter_to_business_tiers(ut.parse_tanks(snapshots["tanks"]))
    total = len(vehicles)

    provision_map, consumable_map = ut.load_catalog()
    vehicles = ut.apply_items(
        vehicles,
        ut.parse_item_defs(snapshots["provisions"]),
        ut.parse_item_defs(snapshots["consumables"]),
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
                "source": "blitzkit snapshot (assets.blitzkit.app/definitions)",
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
        "SAFE_RESULTS snapshot_vehicles=%d %s existing_knowledge=%d preserved_knowledge=%d"
        % (
            total,
            " ".join("tier%d=%d" % (tier, len(per_tier[tier])) for tier in sorted(per_tier)),
            old_knowledge,
            preserved_knowledge,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
