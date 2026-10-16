#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Fail closed on an invalid common/tank_aliases.json.

`tank_aliases.json` is developer-maintained WotBTools **search metadata**, not game
factual data: it only widens Tankopedia search recall and never participates in
vehicle identity or display names (see docs/architecture/tankopedia-reference-data.md).

Because it is hand edited, the contract is enforced here instead of being silently
tolerated at runtime:

- the document is a JSON object mapping a canonical decimal tank id to a non-empty
  array of non-blank alias strings;
- sparse by design: a vehicle with no alias is simply absent (missing key means
  `aliases = []`), so empty arrays are rejected rather than stored;
- every tank id must resolve against the repository's own vehicle reference
  (`common/tankopedia-tier{7,8,9,10}.json`), which keeps validation deterministic and
  offline. Vehicles outside tier 7-10 have no in-repo reference and therefore cannot
  carry aliases.

Cross-tank duplicates stay a diagnostic warning: two vehicles can legitimately share a
community short name, and search ranking — not this validator — decides the winner.
"""

import json
import os

from update_tankopedia import REPO_COMMON_DIR, TIER_FILES

ALIAS_FILENAME = "tank_aliases.json"


def _duplicate_free_object(pairs):
    """json object hook: a repeated tank id would silently drop one hand-written entry."""
    seen = {}
    for key, value in pairs:
        if key in seen:
            raise RuntimeError("TANK_ALIASES_DUPLICATE_TANK_ID: tank_id=%s" % key)
        seen[key] = value
    return seen


def load_alias_document(common_dir=REPO_COMMON_DIR):
    """Read tank_aliases.json. A missing file is a failure: the frontend imports it."""
    path = os.path.join(common_dir, ALIAS_FILENAME)
    if not os.path.isfile(path):
        raise RuntimeError("TANK_ALIASES_FILE_MISSING: path=%s" % path)
    with open(path, encoding="utf-8") as handle:
        return json.load(handle, object_pairs_hook=_duplicate_free_object)


def load_known_tank_ids(common_dir=REPO_COMMON_DIR):
    """Vehicle ids from the in-repo tankopedia reference (tier 7-10, offline)."""
    known = set()
    for filename in TIER_FILES.values():
        path = os.path.join(common_dir, filename)
        with open(path, encoding="utf-8") as handle:
            document = json.load(handle)
        for vehicle in document.get("vehicles") or []:
            tank_id = vehicle.get("id")
            if isinstance(tank_id, int) and not isinstance(tank_id, bool):
                known.add(tank_id)
    if not known:
        raise RuntimeError("TANK_ALIASES_NO_VEHICLE_REFERENCE: common_dir=%s" % common_dir)
    return known


def parse_tank_id(key):
    """Canonical decimal positive integer, or None. Rejects '012', '+1', ' 1', '1.0'."""
    if not isinstance(key, str) or not key.isascii() or not key.isdecimal():
        return None
    tank_id = int(key)
    if tank_id <= 0 or str(tank_id) != key:
        return None
    return tank_id


def validate_tank_aliases(document, known_tank_ids):
    """Raise on any contract violation; return cross-tank duplicate warnings."""
    if not isinstance(document, dict):
        raise RuntimeError("TANK_ALIASES_NOT_OBJECT: type=%s" % type(document).__name__)

    invalid_ids = []
    unknown_ids = []
    not_arrays = []
    empty_arrays = []
    not_strings = []
    blank_aliases = []
    duplicates = []
    owners = {}

    for key, aliases in document.items():
        tank_id = parse_tank_id(key)
        if tank_id is None:
            invalid_ids.append(key)
            continue
        if tank_id not in known_tank_ids:
            unknown_ids.append(tank_id)
            continue
        if not isinstance(aliases, list):
            not_arrays.append((tank_id, type(aliases).__name__))
            continue
        if not aliases:
            empty_arrays.append(tank_id)
            continue

        seen = set()
        for alias in aliases:
            if not isinstance(alias, str):
                not_strings.append((tank_id, type(alias).__name__))
                continue
            trimmed = alias.strip()
            if not trimmed:
                blank_aliases.append(tank_id)
                continue
            # Search normalizes case, so "Death Star" and "death star" are one alias.
            folded = trimmed.casefold()
            if folded in seen:
                duplicates.append((tank_id, trimmed))
                continue
            seen.add(folded)
            owners.setdefault(folded, []).append(tank_id)

    if invalid_ids:
        raise RuntimeError("TANK_ALIASES_INVALID_TANK_ID: keys=%s" % sorted(invalid_ids)[:20])
    if unknown_ids:
        raise RuntimeError("TANK_ALIASES_UNKNOWN_TANK_ID: tank_ids=%s" % sorted(unknown_ids)[:20])
    if not_arrays:
        details = ", ".join("tank_id=%s type=%s" % entry for entry in not_arrays[:20])
        raise RuntimeError("TANK_ALIASES_NOT_ARRAY: " + details)
    if empty_arrays:
        raise RuntimeError(
            "TANK_ALIASES_EMPTY_ARRAY: tank_ids=%s (omit the key instead; missing means aliases=[])"
            % sorted(empty_arrays)[:20]
        )
    if not_strings:
        details = ", ".join("tank_id=%s type=%s" % entry for entry in not_strings[:20])
        raise RuntimeError("TANK_ALIASES_ALIAS_NOT_STRING: " + details)
    if blank_aliases:
        raise RuntimeError("TANK_ALIASES_BLANK_ALIAS: tank_ids=%s" % sorted(blank_aliases)[:20])
    if duplicates:
        details = ", ".join("tank_id=%s alias=%r" % entry for entry in duplicates[:20])
        raise RuntimeError("TANK_ALIASES_DUPLICATE_ALIAS: " + details)

    return [
        "TANK_ALIASES_CROSS_TANK_DUPLICATE: alias=%r tank_ids=%s" % (folded, sorted(tank_ids))
        for folded, tank_ids in sorted(owners.items())
        if len(tank_ids) > 1
    ]


def main():
    document = load_alias_document()
    warnings = validate_tank_aliases(document, load_known_tank_ids())
    for warning in warnings:
        print("WARNING: " + warning)
    print(
        "tank_aliases.json OK: %d vehicles, %d aliases"
        % (len(document), sum(len(aliases) for aliases in document.values()))
    )


if __name__ == "__main__":
    main()
