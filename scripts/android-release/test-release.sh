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

# --- resolve: versionCode formula ---
[ "$(version_code_of 1.0.2)" = "1000002" ] || fail "1.0.2 -> 1000002"
[ "$(version_code_of 1.1.0)" = "1001000" ] || fail "1.1.0 -> 1001000"
[ "$(version_code_of 2.0.0)" = "2000000" ] || fail "2.0.0 -> 2000000"
[ "$(version_code_of 0.1.0)" = "1000" ] || fail "0.1.0 -> 1000"

# --- resolve: tag trigger naming ---
run_resolve push "android-v1.0.2" | grep -qE '^tagName=android-v1.0.2$' || fail "tagName from tag push"
run_resolve push "android-v1.0.2" | grep -qE '^apkName=wotbtools-android-v1.0.2.apk$' || fail "apkName from tag push"

# --- resolve: invalid versions must fail fast ---
for bad in "1" "1.0" "v1.0.2" "1.0.2-rc1" "1.0.02" "01.0.2" "1.0.2.3"; do
  if run_resolve workflow_dispatch "$bad" >/dev/null 2>&1; then
    fail "should reject version '$bad'"
  fi
done

# --- guards ---
. "$GUARDS"

guard_monotonic "" 1000002 || fail "first release should allow"
guard_monotonic 1000001 1000002 || fail "greater should allow"
guard_monotonic 1000002 1000002 && fail "equal should reject"
guard_monotonic 1000002 1000001 && fail "lower should reject"

guard_min_supported 1000000 1000002 || fail "minSupported ok"
guard_min_supported 1001000 1000002 && fail "minSupported over-bound should reject"

guard_tag_absent "" "android-v1.0.2" || fail "tag absent ok"
guard_tag_absent $'refs/tags/android-v1.0.2\nrefs/tags/android-v1.1.0' "android-v1.0.2" && fail "tag present should reject"

echo "ALL TESTS PASSED"
