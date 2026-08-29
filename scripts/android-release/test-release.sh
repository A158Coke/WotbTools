#!/usr/bin/env bash
# Unit tests for the pure Android release helpers. No secrets, never triggers a
# real release or a full Android build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RESOLVE="$ROOT/scripts/android-release/resolve-version.sh"
GUARDS="$ROOT/scripts/android-release/check-release-guards.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

run_resolve() {
  WOTB_TRIGGER="$1" WOTB_INPUT_VERSION="$2" WOTB_COMMIT="deadbeef" bash "$RESOLVE"
}

version_code_of() {
  run_resolve workflow_dispatch "$1" | grep -E '^versionCode=' | cut -d= -f2
}

expect_reject() {
  if run_resolve workflow_dispatch "$1" >/dev/null 2>&1; then
    fail "should reject version '$1'"
  fi
}

# --- resolve: versionCode formula ---
[ "$(version_code_of 1.0.2)" = "1000002" ] || fail "1.0.2 -> 1000002"
[ "$(version_code_of 1.1.0)" = "1001000" ] || fail "1.1.0 -> 1001000"
[ "$(version_code_of 2.0.0)" = "2000000" ] || fail "2.0.0 -> 2000000"
[ "$(version_code_of 0.1.0)" = "1000" ] || fail "0.1.0 -> 1000"
[ "$(version_code_of 0.0.1)" = "1" ] || fail "0.0.1 -> 1"

# --- resolve: minor/patch boundary (0..999) ---
[ "$(version_code_of 1.999.999)" = "1999999" ] || fail "1.999.999 -> 1999999"
[ "$(version_code_of 0.999.999)" = "999999" ] || fail "0.999.999 -> 999999"
expect_reject "1.1000.0"
expect_reject "1.0.1000"
expect_reject "1.1000.1000"

# --- resolve: versionCode legal range ---
[ "$(version_code_of 2100.0.0)" = "2100000000" ] || fail "2100.0.0 -> 2100000000"
expect_reject "0.0.0"          # versionCode 0 not allowed
expect_reject "2101.0.0"       # > 2_100_000_000
expect_reject "999999.0.0"     # major too wide

# --- resolve: tag trigger naming ---
run_resolve push "android-v1.0.2" | grep -qE '^tagName=android-v1.0.2$' || fail "tagName from tag push"
run_resolve push "android-v1.0.2" | grep -qE '^apkName=wotbtools-android-v1.0.2.apk$' || fail "apkName from tag push"

# --- resolve: invalid / non-canonical forms must fail fast (prevents collisions) ---
for bad in "1" "1.0" "v1.0.2" "1.0.2-rc1" "1.0.02" "01.0.2" "1.0.2.3" "1.00.2"; do
  expect_reject "$bad"
done

# --- resolve: distinct canonical versions map to distinct versionCodes (no collision) ---
A="$(version_code_of 1.0.2)"; B="$(version_code_of 1.0.3)"
[ "$A" != "$B" ] || fail "1.0.2 vs 1.0.3 must differ"

# --- guards ---
. "$GUARDS"

guard_min_supported 1000000 1000002 || fail "minSupported ok"
guard_min_supported 1001000 1000002 && fail "minSupported over-bound should reject"

# --- classify_prod (idempotent production version state) ---
write_json() { printf '%s' "$2" > "$TMP/$1"; }
empty_sha='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'

write_json older '{"schemaVersion":1,"latestVersionCode":1000001,"latestVersionName":"1.0.1","minSupportedVersionCode":1000000,"nativeBridgeVersion":1,"apkUrl":"https://wotbtools.com/download/android/wotbtools-android-v1.0.1.apk","sha256":"'$empty_sha'"}'
classify_prod "$TMP/older" 1000002 1.0.2 wotbtools-android-v1.0.2.apk 1000000
[ "$PROD_STATE" = "prod_older" ] || fail "prod_older state"

write_json newer '{"schemaVersion":1,"latestVersionCode":1000003,"latestVersionName":"1.0.3","minSupportedVersionCode":1000000,"nativeBridgeVersion":1,"apkUrl":"https://wotbtools.com/download/android/wotbtools-android-v1.0.3.apk","sha256":"'$empty_sha'"}'
classify_prod "$TMP/newer" 1000002 1.0.2 wotbtools-android-v1.0.2.apk 1000000
[ "$PROD_STATE" = "prod_newer" ] || fail "prod_newer state"

write_json equal_ok '{"schemaVersion":1,"latestVersionCode":1000002,"latestVersionName":"1.0.2","minSupportedVersionCode":1000000,"nativeBridgeVersion":1,"apkUrl":"https://wotbtools.com/download/android/wotbtools-android-v1.0.2.apk","sha256":"'$empty_sha'"}'
classify_prod "$TMP/equal_ok" 1000002 1.0.2 wotbtools-android-v1.0.2.apk 1000000
[ "$PROD_STATE" = "prod_equal_ok" ] || fail "prod_equal_ok state"

write_json equal_conflict '{"schemaVersion":1,"latestVersionCode":1000002,"latestVersionName":"1.0.2","minSupportedVersionCode":1000000,"nativeBridgeVersion":1,"apkUrl":"https://wotbtools.com/download/android/wotbtools-android-v1.0.9.apk","sha256":"'$empty_sha'"}'
classify_prod "$TMP/equal_conflict" 1000002 1.0.2 wotbtools-android-v1.0.2.apk 1000000
[ "$PROD_STATE" = "prod_equal_conflict" ] || fail "prod_equal_conflict state"

# --- classify_prod_apk (idempotent APK upload) ---
classify_prod_apk "" 1000002
[ "$APK_STATE" = "apk_absent" ] || fail "apk_absent state"
classify_prod_apk "abc" "abc"
[ "$APK_STATE" = "apk_equal" ] || fail "apk_equal state"
classify_prod_apk "abc" "def"
[ "$APK_STATE" = "apk_conflict" ] || fail "apk_conflict state"

# --- classify_tag (real `git ls-remote` format: "<sha>\trefs/tags/<tag>") ---
classify_tag "" "android-v1.0.2" 1000002
[ "$TAG_STATE" = "tag_absent" ] || fail "tag_absent state"

classify_tag $'abd123\trefs/tags/android-v1.0.2' "android-v1.0.2" "abd123"
[ "$TAG_STATE" = "tag_equal" ] || fail "tag_equal state"

classify_tag $'abd123\trefs/tags/android-v1.0.2' "android-v1.0.2" "fff000"
[ "$TAG_STATE" = "tag_conflict" ] || fail "tag_conflict state"

# annotated tag emits a peeled ^{} line; the exact ref must still resolve to itself.
classify_tag $'abd123\trefs/tags/android-v1.0.2\nabc999\trefs/tags/android-v1.0.2^{}' "android-v1.0.2" "abd123"
[ "$TAG_STATE" = "tag_equal" ] || fail "annotated tag_equal state"

# a similar-but-different ref must NOT match (exact ref matching).
classify_tag $'abd123\trefs/tags/android-v1.0.20' "android-v1.0.2" "abd123"
[ "$TAG_STATE" = "tag_absent" ] || fail "similar ref must not match (tag_absent)"

echo "ALL TESTS PASSED"
