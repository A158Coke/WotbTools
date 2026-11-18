#!/usr/bin/env bash
# Android release regression suite entry point. Tests use only isolated fixtures.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
REAL_GIT="$(command -v git || true)"
REAL_HEAD="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')"
RESOLVE="$ROOT/scripts/android-release/resolve-version.sh"
RESOLVE_STAGED="$ROOT/scripts/android-release/resolve-staged-version.sh"
GUARDS="$ROOT/scripts/android-release/check-release-guards.sh"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

export ROOT REAL_GIT REAL_HEAD RESOLVE RESOLVE_STAGED GUARDS TMP
bash "$ROOT/scripts/android-release/test-release-delta.sh"

COMMITTED_VERSION="$(sed -n 's/^wotbVersion=//p' "$ROOT/android/gradle.properties" | head -n1)"
if [[ ! "$COMMITTED_VERSION" =~ ^([0-9]+)\.([0-9]+)\.([0-9]+)$ ]]; then
  echo "FAIL: committed version is not X.Y.Z: $COMMITTED_VERSION" >&2
  exit 1
fi
EXPECTED_CODE=$(( BASH_REMATCH[1] * 1000000 + BASH_REMATCH[2] * 1000 + BASH_REMATCH[3] ))
EXPECTED_BRIDGE="$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1], encoding="utf-8"))["bridgeVersion"])' "$ROOT/contracts/android-native-bridge.json")"
STAGED_VERSION="2.0.1"
NEXT_VERSION="2.0.2"
STAGED_SOURCE="$(printf 'a%.0s' $(seq 40))"
STAGED_APK="wotbtools-android-v$STAGED_VERSION.apk"
STAGED_VERSION_CODE=2000001
export COMMITTED_VERSION EXPECTED_CODE EXPECTED_BRIDGE STAGED_VERSION NEXT_VERSION STAGED_SOURCE STAGED_APK STAGED_VERSION_CODE

for test_script in \
  test-release-identity.sh \
  test-release-bundle-contract.sh \
  test-release-staging.sh \
  test-release-protocol.sh \
  test-release-publish-simulation.sh \
  test-release-candidate-scheduling.sh \
  test-release-classifiers.sh; do
  bash "$ROOT/scripts/android-release/$test_script"
done
