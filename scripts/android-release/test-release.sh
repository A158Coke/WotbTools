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

resolve() {
  WOTB_ROOT="$ROOT" WOTB_TRIGGER="$1" WOTB_TAG_NAME="${2:-}" WOTB_COMMIT="deadbeef" bash "$RESOLVE"
}

resolve workflow_dispatch | grep -q '^versionName=1.4.2$' || fail "committed version authority"
resolve workflow_dispatch | grep -q '^versionCode=1004002$' || fail "versionCode formula"
resolve workflow_dispatch | grep -q '^nativeBridgeVersion=1$' || fail "bridge version from contract"
resolve push android-v1.4.2 | grep -q '^tagName=android-v1.4.2$' || fail "compatible tag"
if resolve push android-v9.9.9 >/dev/null 2>&1; then fail "mismatched tag must fail"; fi

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

echo "ALL ANDROID RELEASE TESTS PASSED"
