#!/usr/bin/env python3
"""Sync equipment using one BlitzKit protobuf snapshot plus reviewed source locks."""

import argparse
import json

import update_equipment as ue
from validate_locked_equipment_contract import validate_locked_contract_from_pb


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", default="common/wotb-item-catalog-json/equipment.json")
    args = parser.parse_args(argv)

    with open(args.catalog, encoding="utf-8") as file:
        payload = json.load(file)

    # Fetch mutable protobuf inputs exactly once. Every coverage/description
    # validation in this run is performed against these same bytes.
    equipment_pb = ue.fetch(ue.EQUIPMENT_URL, binary=True)
    tanks_pb = ue.fetch(ue.PB_URL, binary=True)
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
    # Re-run the locked contract after mutation to guarantee the automatic
    # rewrite path never touched a locked item based on partial knowledge.
    validate_locked_contract_from_pb(payload, equipment_pb)

    with open(args.catalog, "w", encoding="utf-8", newline="\n") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)
        file.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
