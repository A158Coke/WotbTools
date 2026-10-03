#!/usr/bin/env bash
# Resolve Android release metadata from committed repository files.
# `android/gradle.properties` is authoritative for the **current** source (stage / push / tag).
#
# 两个 owner（PR #467 review P2）：
#   - 默认路径：读工作区 android/gradle.properties ⇒ 当前 main 的版本（stage 用）。
#   - WOTB_STAGED_PROPERTIES / WOTB_STAGED_FROM_REF：读 **tag target** 的版本 ⇒ 已 staged 的
#     历史候选（publish 用）。此时 WOTB_REQUESTED_VERSION 必填，且必须与 staged 版本完全相等，
#     否则 fail closed —— publish 绝不允许「按当前 main 的版本去猜候选」。
#
# A pushed android-vX.Y.Z tag remains a compatibility entry point and must match it.
set -euo pipefail

TRIGGER="${WOTB_TRIGGER:-}"
ROOT="${WOTB_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
TAG_NAME="${WOTB_TAG_NAME:-}"
STAGED_PROPERTIES="${WOTB_STAGED_PROPERTIES:-}"
STAGED_REF="${WOTB_STAGED_FROM_REF:-}"
REQUESTED_VERSION="${WOTB_REQUESTED_VERSION:-}"

if [ -z "$TRIGGER" ]; then
  echo "::error::WOTB_TRIGGER is required" >&2
  exit 1
fi
if [ -z "$STAGED_PROPERTIES" ] && [ -n "$STAGED_REF" ]; then
  echo "::error::WOTB_STAGED_FROM_REF requires WOTB_STAGED_PROPERTIES (read it with: git show <ref>:android/gradle.properties)" >&2
  exit 1
fi

python3 - "$ROOT" "$TRIGGER" "$TAG_NAME" "${WOTB_COMMIT:-}" "$STAGED_PROPERTIES" "$REQUESTED_VERSION" <<'PY'
import sys
from pathlib import Path

root = Path(sys.argv[1])
trigger = sys.argv[2]
tag = sys.argv[3]
commit = sys.argv[4]
staged_properties = sys.argv[5]
requested_version = sys.argv[6]
sys.path.insert(0, str(root / "scripts" / "android-release"))
from android_contract import load_json, parse_version, properties, version_code

if staged_properties:
    # staged 路径：版本只能来自 tag target，工作区文件完全不参与。
    props = properties(Path(staged_properties).read_text(encoding="utf-8"))
else:
    props = properties((root / "android" / "gradle.properties").read_text(encoding="utf-8"))
version = props.get("wotbVersion", "")
parts = parse_version(version)
if not requested_version and staged_properties:
    raise SystemExit("WOTB_REQUESTED_VERSION is required when resolving a staged release source")
if requested_version and requested_version != version:
    raise SystemExit(
        f"Requested version {requested_version!r} does not match the staged source version {version!r}; "
        "refusing to publish a candidate that was not staged under this version"
    )
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
