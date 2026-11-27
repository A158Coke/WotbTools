#!/usr/bin/env python3
"""Fail-closed readiness check for the bundled version-diff page (Android 5.8.0+).

The APK embeds the frontend bundle; `?view=agent-version-diff` reads the production
asset origin's /diffs tree. Documentation is not a release gate, so this check runs in
the stage preflight (before any immutable candidate exists) and again in publish
readiness:

  - /diffs/index.json must be HTTP 200, schema 1 and contain at least one pair;
  - every pair's summary.json must be HTTP 200 with schema 1;
  - both datasets referenced by a pair must serve /v/<dataset>/version.json whose
    `release` matches the pair metadata (a stale diff tree fails).

Usage: check_agent_diffs_ready.py <assetOrigin> <wotbVersion>
"""

from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request

VERSION_DIFF_MIN = (5, 8, 0)
TIMEOUT_SECONDS = 20


def version_tuple(raw: str) -> tuple[int, int, int]:
    parts = raw.split(".")
    if len(parts) < 2 or not all(part.isdigit() for part in parts[:3]):
        raise SystemExit(f"::error::invalid wotbVersion {raw!r}")
    nums = [int(part) for part in parts[:3]] + [0, 0, 0]
    return nums[0], nums[1], nums[2]


def fetch_json(url: str, label: str) -> dict:
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            if response.status != 200:
                raise SystemExit(f"::error::{label} returned HTTP {response.status} ({url}).")
            payload = response.read()
    except urllib.error.HTTPError as error:
        raise SystemExit(f"::error::{label} returned HTTP {error.code} ({url}).") from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise SystemExit(f"::error::{label} is unreachable ({url}): {error}.") from error
    try:
        doc = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SystemExit(f"::error::{label} is not valid JSON ({url}): {error}.") from error
    if not isinstance(doc, dict):
        raise SystemExit(f"::error::{label} is not a JSON object ({url}).")
    return doc


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        raise SystemExit("usage: check_agent_diffs_ready.py <assetOrigin> <wotbVersion>")
    origin = argv[1].rstrip("/")
    version = argv[2]
    if version_tuple(version) < VERSION_DIFF_MIN:
        print(f"agent /diffs gate: wotbVersion {version} predates the version-diff page; skip")
        return 0

    index = fetch_json(f"{origin}/diffs/index.json", "agent /diffs/index.json")
    pairs = index.get("pairs")
    if index.get("schema") != 1 or not isinstance(pairs, list) or not pairs:
        raise SystemExit("::error::agent /diffs/index.json has an unsupported schema or no pairs.")
    print(f"agent /diffs index: {len(pairs)} pair(s)")

    versions: dict[str, str] = {}
    for pair in pairs:
        if not isinstance(pair, dict):
            raise SystemExit("::error::agent /diffs/index.json contains a malformed pair.")
        path = pair.get("path")
        if not isinstance(path, str) or not path:
            raise SystemExit("::error::agent /diffs/index.json contains a pair without a path.")
        summary = fetch_json(f"{origin}/diffs/{path}/summary.json", f"agent /diffs/{path}/summary.json")
        if summary.get("schema") != 1:
            raise SystemExit(f"::error::agent /diffs/{path}/summary.json has an unsupported schema.")
        for side in ("from", "to"):
            identity = pair.get(side)
            if not isinstance(identity, dict) or not isinstance(identity.get("dataset"), str):
                raise SystemExit(f"::error::agent /diffs pair {path} is missing its {side} dataset.")
            dataset = identity["dataset"]
            expected = identity.get("release")
            # pair 是 release 绑定的唯一声明：缺字段/空值/错类型都不能放行，否则旧 diff 可冒充新包。
            if not isinstance(expected, str) or not expected:
                raise SystemExit(
                    f"::error::agent /diffs pair {path} is missing a non-empty {side} release "
                    f"for dataset {dataset}."
                )
            if dataset not in versions:
                stamp = fetch_json(f"{origin}/v/{dataset}/version.json", f"dataset {dataset} version.json")
                actual = stamp.get("release")
                versions[dataset] = actual if isinstance(actual, str) else ""
            actual = versions[dataset]
            if actual != expected:
                raise SystemExit(
                    f"::error::agent /diffs pair {path} declares {dataset} release {expected} "
                    f"but the origin serves {actual or 'none'} (stale diff)."
                )
        print(f"agent /diffs pair OK: {path}")
    print(f"agent /diffs channel readiness: OK ({origin})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))