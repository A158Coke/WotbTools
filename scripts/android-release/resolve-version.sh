#!/usr/bin/env bash
# Resolve Android release metadata from committed repository files.
# The workflow has no version input: android/gradle.properties is authoritative.
# A pushed android-vX.Y.Z tag remains a compatibility entry point and must match it.
set -euo pipefail

TRIGGER="${WOTB_TRIGGER:-}"
ROOT="${WOTB_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
TAG_NAME="${WOTB_TAG_NAME:-}"

if [ -z "$TRIGGER" ]; then
  echo "::error::WOTB_TRIGGER is required" >&2
  exit 1
fi

python3 - "$ROOT" "$TRIGGER" "$TAG_NAME" "${WOTB_COMMIT:-}" <<'PY'
import sys
from pathlib import Path

root = Path(sys.argv[1])
trigger = sys.argv[2]
tag = sys.argv[3]
commit = sys.argv[4]
sys.path.insert(0, str(root / "scripts" / "android-release"))
from android_contract import load_json, parse_version, properties, version_code

props = properties((root / "android" / "gradle.properties").read_text(encoding="utf-8"))
version = props.get("wotbVersion", "")
parts = parse_version(version)
contract = load_json(root / "contracts" / "android-native-bridge.json")
bridge = contract.get("bridgeVersion")
if props.get("wotbNativeBridgeVersion") != str(bridge):
    raise SystemExit("android/gradle.properties bridge version does not match the JSON contract")
if trigger not in {"workflow_dispatch", "push"}:
    raise SystemExit(f"Unsupported trigger: {trigger}")
if trigger == "push" and tag:
    expected = f"android-v{version}"
    if tag != expected:
        raise SystemExit(f"Release tag {tag!r} does not match committed version {expected!r}")

metadata = {
    "versionName": version,
    "versionCode": version_code(parts),
    "tagName": f"android-v{version}",
    "apkName": f"wotbtools-android-v{version}.apk",
    "nativeBridgeVersion": bridge,
    "commit": commit,
}
for key, value in metadata.items():
    print(f"{key}={value}")
PY
