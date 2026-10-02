#!/usr/bin/env bash
# Pure Android release helper tests: committed version authority, contract gate,
# and production state classification. No secrets or release side effects.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RESOLVE="$ROOT/scripts/android-release/resolve-version.sh"
GUARDS="$ROOT/scripts/android-release/check-release-guards.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

python3 - "$ROOT/.github/workflows/android-release.yml" <<'PY'
import sys
import yaml

workflow = yaml.safe_load(open(sys.argv[1], encoding="utf-8"))
trigger = workflow.get(True, workflow.get("on", {}))
push = trigger["push"]
assert "android/gradle.properties" in push["paths"], "Android release must be version-triggered"
assert "android-v*" in push["tags"], "Android tag recovery trigger is missing"
PY

resolve() {
  WOTB_ROOT="$ROOT" WOTB_TRIGGER="$1" WOTB_TAG_NAME="${2:-}" WOTB_COMMIT="deadbeef" bash "$RESOLVE"
}

# 期望值取自已提交的 android/gradle.properties，而不是写死某个版本：每次发版升号都不该改测试。
COMMITTED_VERSION="$(sed -n 's/^wotbVersion=//p' "$ROOT/android/gradle.properties" | head -n1)"
[[ "$COMMITTED_VERSION" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || fail "committed version is not X.Y.Z: $COMMITTED_VERSION"
EXPECTED_CODE=$(( BASH_REMATCH[1] * 1000000 + BASH_REMATCH[2] * 1000 + BASH_REMATCH[3] ))
# Bridge 版本同样取自已提交的 contract：bridge 升版不该改测试。
EXPECTED_BRIDGE="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1], encoding="utf-8"))["bridgeVersion"])' "$ROOT/contracts/android-native-bridge.json")"
resolve workflow_dispatch | grep -qx "versionName=$COMMITTED_VERSION" || fail "committed version authority"
resolve workflow_dispatch | grep -qx "versionCode=$EXPECTED_CODE" || fail "versionCode formula"
resolve workflow_dispatch | grep -qx "nativeBridgeVersion=$EXPECTED_BRIDGE" || fail "bridge version from contract"
resolve push "android-v$COMMITTED_VERSION" | grep -qx "tagName=android-v$COMMITTED_VERSION" || fail "compatible tag"
if resolve push android-v9.9.9 >/dev/null 2>&1; then fail "mismatched tag must fail"; fi

# 纯 bash 的 bridge cutover guard，不依赖 jq，因此本机也能跑。
. "$GUARDS"
bridge_cutover_code=2000000
guard_bridge_covered 1 2 "2" "$bridge_cutover_code" "$bridge_cutover_code" || fail "configured bridge cutover must pass"
if guard_bridge_covered 1 2 "2" 1000000 "$bridge_cutover_code"; then fail "dropped bridge without mandatory update must fail"; fi
guard_bridge_covered 1 2 "1,2" 1000000 "$bridge_cutover_code" || fail "frontend still serving the old bridge needs no cutover"
guard_bridge_covered "" 2 "2" 1000000 "$bridge_cutover_code" || fail "first release needs no cutover"
guard_bridge_covered 2 2 "2" 1000000 2001000 || fail "unchanged bridge needs no cutover"
if guard_bridge_covered 1 2 "" 1000000 "$bridge_cutover_code" 2>/dev/null; then fail "empty frontend version set must not be treated as coverage"; fi

python3 "$ROOT/scripts/android-release/android_contract.py" version 1.0.2 | grep -q '1000002' || fail "version parser"
if python3 "$ROOT/scripts/android-release/android_contract.py" version 1.0.02 >/dev/null 2>&1; then fail "invalid version must fail"; fi
bash "$ROOT/scripts/android-release/test-android-contract.sh"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is unavailable; production JSON classifier cases are CI-only"
  exit 0
fi

. "$GUARDS"
guard_min_supported 1000000 1000002 || fail "minSupported ok"
if guard_min_supported 1001000 1000002; then fail "minSupported over-bound should reject"; fi

write_json() { printf '%s' "$2" > "$TMP/$1"; }
sha='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
source_sha='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
write_json older '{"schemaVersion":1,"latestVersionCode":1000001,"latestVersionName":"1.0.1","minSupportedVersionCode":1000000,"nativeBridgeVersion":1,"apkUrl":"https://wotbtools.com/download/android/wotbtools-android-v1.0.1.apk","sha256":"'$sha'"}'
classify_prod "$TMP/older" 1000002 1.0.2 wotbtools-android-v1.0.2.apk 1000000 1
[ "$PROD_STATE" = prod_older ] || fail "prod_older"
write_json newer '{"schemaVersion":1,"latestVersionCode":1000003,"latestVersionName":"1.0.3","minSupportedVersionCode":1000000,"nativeBridgeVersion":1,"apkUrl":"https://wotbtools.com/download/android/wotbtools-android-v1.0.3.apk","sha256":"'$sha'"}'
classify_prod "$TMP/newer" 1000002 1.0.2 wotbtools-android-v1.0.2.apk 1000000 1
[ "$PROD_STATE" = prod_newer ] || fail "prod_newer"
write_json equal '{"schemaVersion":1,"latestVersionCode":1000002,"latestVersionName":"1.0.2","minSupportedVersionCode":1000000,"nativeBridgeVersion":1,"sourceSha":"'$source_sha'","apkUrl":"https://wotbtools.com/download/android/wotbtools-android-v1.0.2.apk","sha256":"'$sha'"}'
classify_prod "$TMP/equal" 1000002 1.0.2 wotbtools-android-v1.0.2.apk 1000000 1 "$source_sha"
[ "$PROD_STATE" = prod_equal_ok ] || fail "prod_equal_ok"
classify_prod "$TMP/equal" 1000002 1.0.2 wotbtools-android-v1.0.2.apk 1000000 1 wrong-source-sha
[ "$PROD_STATE" = prod_equal_conflict ] || fail "sourceSha conflict"
sed 's/"nativeBridgeVersion":1/"nativeBridgeVersion":2/' "$TMP/equal" > "$TMP/bridge-conflict"
classify_prod "$TMP/bridge-conflict" 1000002 1.0.2 wotbtools-android-v1.0.2.apk 1000000 1
[ "$PROD_STATE" = prod_equal_conflict ] || fail "bridge conflict"

classify_prod_apk "" 1000002
[ "$APK_STATE" = apk_absent ] || fail "apk_absent"
classify_prod_apk abc abc
[ "$APK_STATE" = apk_equal ] || fail "apk_equal"
classify_prod_apk abc def
[ "$APK_STATE" = apk_conflict ] || fail "apk_conflict"

classify_tag "" android-v1.0.2 1000002
[ "$TAG_STATE" = tag_absent ] || fail "tag_absent"
classify_tag $'abc\trefs/tags/android-v1.0.2' android-v1.0.2 abc
[ "$TAG_STATE" = tag_equal ] || fail "tag_equal"
classify_tag $'abc\trefs/tags/android-v1.0.2\ndef456\trefs/tags/android-v1.0.2^{}' android-v1.0.2 def456
[ "$TAG_STATE" = tag_equal ] || fail "annotated tag_equal"

classify_tag $'abc\trefs/tags/android-v1.0.2' android-v1.0.2 def456
[ "$TAG_STATE" = tag_conflict ] || fail "tag_conflict"

python3 - "$ROOT/.github/workflows/android-release.yml" <<'PY'
from pathlib import Path
import sys

workflow = Path(sys.argv[1]).read_text(encoding="utf-8")
preflight = workflow.index("Preflight classify production state")
frontend = workflow.index("Frontend tests + build validation")
upload = workflow.index("Upload APK to TX")
ensure_tag = workflow.index("Ensure release tag (idempotent)")
assert preflight < frontend < upload < ensure_tag
preflight_block = workflow[preflight:frontend]
assert 'classify_tag "$REFS" "$TAG" "$COMMIT_SHA"' in preflight_block
assert 'if [ "$TAG_STATE" = "tag_conflict" ]; then' in preflight_block
PY

echo "ALL ANDROID RELEASE TESTS PASSED"
