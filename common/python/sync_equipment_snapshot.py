#!/usr/bin/env python3
"""Sync equipment from one stable BlitzKit protobuf snapshot plus reviewed source locks."""

import argparse
import json

import update_equipment as ue
from blitzkit_snapshot import fetch_stable_snapshot
from validate_locked_equipment_contract import validate_locked_contract_from_pb


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", default="common/wotb-item-catalog-json/equipment.json")
    args = parser.parse_args(argv)

    with open(args.catalog, encoding="utf-8") as file:
        payload = json.load(file)

    resources = {
        "equipment": ue.EQUIPMENT_URL,
        "tanks": ue.PB_URL,
    }
    snapshots, hashes = fetch_stable_snapshot(
        resources,
        lambda url: ue.fetch(url, binary=True),
    )
    print(
        "stable equipment snapshot: %s"
        % " ".join("%s=%s" % (name, hashes[name][:12]) for name in sorted(hashes))
    )

    equipment_pb = snapshots["equipment"]
    tanks_pb = snapshots["tanks"]
    ue.validate_upstream_contract(payload, equipment_pb, tanks_pb)
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
    validate_locked_contract_from_pb(payload, equipment_pb)

    with open(args.catalog, "w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
