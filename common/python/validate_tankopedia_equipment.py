#!/usr/bin/env python3
"""Fail closed when tier 7-10 Tankopedia equipment coverage is incomplete."""

import urllib.request

from update_tankopedia import (
    EQUIPMENT_URL,
    PB_URL,
    filter_to_business_tiers,
    load_equipment_catalog,
    parse_equipment_defs,
    parse_tanks,
)

# Empty by default. Any business-tier vehicle without a preset must be reviewed
# and explicitly allowlisted by tank id before the data sync can proceed.
KNOWN_NO_EQUIPMENT_PRESET_IDS = set()


def validate_vehicle_equipment_coverage(
    vehicles,
    presets,
    equipment_map,
    allowed_missing_preset_ids=None,
):
    """Require every business-tier vehicle preset and equipment ID to be known locally."""
    allowed_missing = set(
        KNOWN_NO_EQUIPMENT_PRESET_IDS
        if allowed_missing_preset_ids is None
        else allowed_missing_preset_ids
    )
    missing_vehicle_presets = []
    missing_upstream_presets = []
    unknown_ids = []
    known_ids = set(equipment_map)

    for vehicle in vehicles.values():
        vehicle_id = vehicle.get("id")
        preset_name = vehicle.get("_equipmentPreset")
        if not preset_name:
            if vehicle_id not in allowed_missing:
                missing_vehicle_presets.append(vehicle_id)
            continue
        if preset_name not in presets:
            missing_upstream_presets.append((vehicle_id, preset_name))
            continue

        missing = sorted(set(presets[preset_name]) - known_ids)
        if missing:
            unknown_ids.append((vehicle_id, preset_name, missing))

    if missing_vehicle_presets:
        raise RuntimeError(
            "TANKOPEDIA_VEHICLE_EQUIPMENT_PRESET_MISSING: vehicle_ids=%s"
            % sorted(missing_vehicle_presets)[:50]
        )

    if missing_upstream_presets:
        details = ", ".join(
            "vehicle=%s preset=%s" % (vehicle_id, preset_name)
            for vehicle_id, preset_name in missing_upstream_presets[:20]
        )
        raise RuntimeError("TANKOPEDIA_EQUIPMENT_PRESET_MISSING: " + details)

    if unknown_ids:
        details = ", ".join(
            "vehicle=%s preset=%s ids=%s" % (vehicle_id, preset_name, ids)
            for vehicle_id, preset_name, ids in unknown_ids[:20]
        )
        raise RuntimeError("TANKOPEDIA_UNKNOWN_EQUIPMENT_ID: " + details)

    return True


def fetch_bytes(url):
    with urllib.request.urlopen(url, timeout=60) as response:
        return response.read()


def main():
    vehicles = filter_to_business_tiers(parse_tanks(fetch_bytes(PB_URL)))
    presets, _ = parse_equipment_defs(fetch_bytes(EQUIPMENT_URL))
    equipment_map = load_equipment_catalog()
    validate_vehicle_equipment_coverage(vehicles, presets, equipment_map)
    print("Tankopedia equipment coverage OK: %d business-tier vehicles" % len(vehicles))


if __name__ == "__main__":
    main()
