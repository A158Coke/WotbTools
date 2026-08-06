#!/usr/bin/env python3
"""Check that every Keycloak version reference in the repo is in sync.

Usage:
    python check_versions.py [expected_version]

Scans (relative to the repo root, derived from this script's location):
  - docker/Dockerfile.keycloak          FROM quay.io/keycloak/keycloak:<tag>
  - keycloak-*/pom.xml                  <keycloak.version> property
  - frontend/package.json               keycloak-js dependency (informational)
  - frontend/package-lock.json          keycloak-js resolved version (informational)

Exit code 0 = server image tag and both provider poms agree (and, when given,
equal the expected version). Exit code 1 = mismatch.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except AttributeError:
    pass

REPO_ROOT = Path(__file__).resolve().parents[4]

FROM_RE = re.compile(r"FROM\s+quay\.io/keycloak/keycloak:([0-9][0-9A-Za-z.\-]*)", re.IGNORECASE)
POM_VERSION_RE = re.compile(r"<keycloak\.version>\s*([0-9][0-9A-Za-z.\-]*)\s*</keycloak\.version>")
PACKAGE_JSON_RE = re.compile(r'"keycloak-js"\s*:\s*"([^"]+)"')
PACKAGE_LOCK_RE = re.compile(r'"node_modules/keycloak-js":\s*\{[^}]*?"version":\s*"([^"]+)"')


def find_version(path: Path, pattern: re.Pattern[str], label: str) -> str | None:
    if not path.exists():
        print(f"  [MISSING] {label}: {path.relative_to(REPO_ROOT)} not found")
        return None
    match = pattern.search(path.read_text(encoding="utf-8", errors="replace"))
    if not match:
        print(f"  [NOT FOUND] {label}: no version reference in {path.relative_to(REPO_ROOT)}")
        return None
    version = match.group(1)
    print(f"  {label}: {version}  ({path.relative_to(REPO_ROOT)})")
    return version


def main() -> int:
    expected = sys.argv[1] if len(sys.argv) > 1 else None
    print(f"Checking Keycloak versions in {REPO_ROOT}")

    image_tag = find_version(REPO_ROOT / "docker" / "Dockerfile.keycloak", FROM_RE, "image tag")
    wg_pom = find_version(
        REPO_ROOT / "keycloak-wargaming-provider" / "pom.xml", POM_VERSION_RE, "wargaming pom"
    )
    qq_pom = find_version(
        REPO_ROOT / "keycloak-juhe-qq-provider" / "pom.xml", POM_VERSION_RE, "juhe-qq pom"
    )

    server_versions = [v for v in (image_tag, wg_pom, qq_pom) if v]
    if not server_versions:
        print("\nERROR: could not find any Keycloak version reference.")
        return 1

    if expected:
        print(f"\nExpected version (argument): {expected}")

    mismatches = []
    for label, version in (
        ("image tag", image_tag),
        ("wargaming pom", wg_pom),
        ("juhe-qq pom", qq_pom),
    ):
        if version != server_versions[0]:
            mismatches.append(f"{label}={version!r}")
        if expected and version != expected:
            mismatches.append(f"{label}={version!r} (expected {expected})")

    print(f"\nSynced server version: {server_versions[0]}")
    if mismatches:
        print("MISMATCH: " + "; ".join(sorted(set(mismatches))))
        return 1

    js_raw = find_version(
        REPO_ROOT / "frontend" / "package.json", PACKAGE_JSON_RE, "keycloak-js (package.json)"
    )
    js_locked = find_version(
        REPO_ROOT / "frontend" / "package-lock.json", PACKAGE_LOCK_RE, "keycloak-js (package-lock.json)"
    )
    js_version = js_raw[1:] if js_raw and js_raw[:1] in "^~" else js_raw
    print("\nNote: keycloak-js is informational (26.2+ releases independently, backward compatible).")
    if js_version and js_locked and js_version != js_locked:
        print(f"MISMATCH: package.json keycloak-js {js_raw} and package-lock.json {js_locked} differ; run 'npm install'.")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
