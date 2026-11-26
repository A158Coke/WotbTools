#!/usr/bin/env bash
set -euo pipefail
source "$ROOT/scripts/android-release/test-release-common.sh"

resolve workflow_dispatch | grep -qx "versionName=$COMMITTED_VERSION" || fail "committed version authority"
resolve workflow_dispatch | grep -qx "versionCode=$EXPECTED_CODE" || fail "versionCode formula"
resolve workflow_dispatch | grep -qx "nativeBridgeVersion=$EXPECTED_BRIDGE" || fail "bridge version from contract"
resolve push "android-v$COMMITTED_VERSION" | grep -qx "tagName=android-v$COMMITTED_VERSION" || fail "compatible tag"
if resolve push android-v9.9.9 >/dev/null 2>&1; then fail "mismatched tag must fail"; fi

RELEASE_NOTE="$ROOT/docs/android/releases/$COMMITTED_VERSION.md"
if [ -f "$RELEASE_NOTE" ]; then
  grep -q "versionName：$COMMITTED_VERSION" "$RELEASE_NOTE" || fail "release note versionName mismatch"
  grep -q "versionCode：$EXPECTED_CODE" "$RELEASE_NOTE" || fail "release note versionCode mismatch"
  grep -q "Native Bridge：v$EXPECTED_BRIDGE" "$RELEASE_NOTE" || fail "release note Native Bridge mismatch"
  grep -q "releases/$COMMITTED_VERSION.md" "$ROOT/docs/android/release-process.md" || fail "release-process is missing the current release note link"
else
  echo "release note archived/removed; skipping temporary note checks for $COMMITTED_VERSION"
  if grep -q "releases/$COMMITTED_VERSION.md" "$ROOT/docs/android/release-process.md"; then
    fail "release-process still links removed release note: docs/android/releases/$COMMITTED_VERSION.md"
  fi
fi
grep -q "\*\*$COMMITTED_VERSION / $EXPECTED_CODE\*\*" "$ROOT/docs/android/release-process.md" || fail "release-process current version does not match committed wotbVersion"
grep -qx "wotbNativeBridgeVersion=$EXPECTED_BRIDGE" "$ROOT/android/gradle.properties" || fail "committed Native Bridge version does not match the contract"


if ! command -v git >/dev/null 2>&1 || ! git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  echo "git is unavailable; the staged-candidate cases are CI-only"
else
  make_staged_source() {
    local version="$1" contract="$2"
    local dir="$TMP/staged-src-$version-$RANDOM"
    mkdir -p "$dir/android" "$dir/contracts" "$dir/deploy/agent"
    cp "$contract" "$dir/contracts/android-native-bridge.json"
    cp "$ROOT/deploy/agent/source.json" "$dir/deploy/agent/source.json"
    printf 'wotbVersion=%s\nwotbNativeBridgeVersion=%s\n' "$version" \
      "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1], encoding="utf-8"))["bridgeVersion"])' "$contract")" \
      > "$dir/android/gradle.properties"
    git -C "$dir" init -q
    git -C "$dir" config user.email test@example.invalid
    git -C "$dir" config user.name test
    git -C "$dir" add -A
    git -C "$dir" commit -qm "stage $version"
    git -C "$dir" tag "android-v$version"
    printf '%s' "$dir"
  }

  resolve_staged() {
    local repo="$1" ref="$2" requested="${3:-}"
    local dir="$TMP/resolved-$RANDOM"
    mkdir -p "$dir/android"
    git -C "$repo" show "$ref:android/gradle.properties" > "$dir/android/gradle.properties"
    WOTB_ROOT="$ROOT" WOTB_TRIGGER=workflow_dispatch WOTB_TAG_NAME="" \
      WOTB_COMMIT="$ref" WOTB_STAGED_REF="$ref" \
      WOTB_STAGED_PROPERTIES="$dir/android/gradle.properties" \
      WOTB_REQUESTED_VERSION="$requested" \
      bash "$RESOLVE_STAGED" 2>&1
  }

  STAGED_REPO="$(make_staged_source "$STAGED_VERSION" "$ROOT/contracts/android-native-bridge.json")"
  STAGED_REF="$(git -C "$STAGED_REPO" rev-parse HEAD)"

  OUT="$(resolve_staged "$STAGED_REPO" "$STAGED_REF" "$STAGED_VERSION")"
  echo "$OUT" | grep -qx "versionName=$STAGED_VERSION" || fail "historical staged candidate must select $STAGED_VERSION: $OUT"
  echo "$OUT" | grep -qx "versionCode=$STAGED_VERSION_CODE" || fail "staged versionCode must come from the tag target: $OUT"
  echo "$OUT" | grep -qx "tagName=android-v$STAGED_VERSION" || fail "staged tag must be derived from the requested version: $OUT"
  echo "$OUT" | grep -qx "apkName=$STAGED_APK" || fail "staged APK name must be derived from the requested version: $OUT"

  if resolve_staged "$STAGED_REPO" "$STAGED_REF" "" >/dev/null 2>&1; then
    fail "publish without an explicit version must fail"
  fi

  if resolve_staged "$STAGED_REPO" "$STAGED_REF" "$NEXT_VERSION" >/dev/null 2>&1; then
    fail "requesting a version that was not staged must fail"
  fi

  NEXT_REPO="$(make_staged_source "$NEXT_VERSION" "$ROOT/contracts/android-native-bridge.json")"
  NEXT_REF="$(git -C "$NEXT_REPO" rev-parse HEAD)"
  if resolve_staged "$NEXT_REPO" "$NEXT_REF" "$STAGED_VERSION" >/dev/null 2>&1; then
    fail "tag target version differing from the requested version must fail"
  fi

  OTHER_CONTRACT="$TMP/other-contract.json"
  python3 -c 'import json,sys; doc=json.load(open(sys.argv[1], encoding="utf-8")); doc["bridgeVersion"]=int(doc["bridgeVersion"])+1; json.dump(doc, open(sys.argv[2], "w", encoding="utf-8"))' \
    "$ROOT/contracts/android-native-bridge.json" "$OTHER_CONTRACT"
  DRIFT_REPO="$(make_staged_source "$STAGED_VERSION" "$OTHER_CONTRACT")"
  DRIFT_REF="$(git -C "$DRIFT_REPO" rev-parse HEAD)"
  if resolve_staged "$DRIFT_REPO" "$DRIFT_REF" "$STAGED_VERSION" >/dev/null 2>&1; then
    fail "staged source whose contract bridge disagrees with its gradle.properties must fail"
  fi
fi

. "$GUARDS"
bridge_cutover_code=2000000
guard_bridge_covered 1 2 "2" "$bridge_cutover_code" "$bridge_cutover_code" || fail "configured bridge cutover must pass"
if guard_bridge_covered 1 2 "2" 1000000 "$bridge_cutover_code"; then fail "dropped bridge without mandatory update must fail"; fi
guard_bridge_covered 1 2 "1,2" 1000000 "$bridge_cutover_code" || fail "frontend still serving the old bridge needs no cutover"
guard_bridge_covered "" 2 "2" 1000000 "$bridge_cutover_code" || fail "first release needs no cutover"
guard_bridge_covered 2 2 "2" 1000000 2001000 || fail "unchanged bridge needs no cutover"
if guard_bridge_covered 1 2 "" 1000000 "$bridge_cutover_code" 2>/dev/null; then fail "empty frontend version set must not be treated as coverage"; fi

staged_a='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
staged_b='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
apk_sha='dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd'
apk_sha_other='eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
guard_staged_release_identity "$staged_a" "$staged_a" "$staged_a" "$apk_sha" "$apk_sha" \
  || fail "matching tag/evidence/APK identity must pass"
if guard_staged_release_identity "$staged_b" "$staged_a" "$staged_a" "$apk_sha" "$apk_sha" 2>/dev/null; then
  fail "a tag pointing at another commit must fail"
fi
if guard_staged_release_identity "$staged_a" "$staged_a" "$staged_b" "$apk_sha" "$apk_sha" 2>/dev/null; then
  fail "staging evidence from another commit must fail"
fi
if guard_staged_release_identity "$staged_a" "$staged_a" "$staged_a" "$apk_sha" "$apk_sha_other" 2>/dev/null; then
  fail "a staged APK whose SHA-256 differs from the evidence must fail"
fi
if guard_staged_release_identity "" "$staged_a" "$staged_a" "$apk_sha" "$apk_sha" 2>/dev/null; then
  fail "a missing/absent release tag must fail"
fi
if guard_staged_release_identity "$staged_a" "$staged_a" "$staged_a" "not-a-sha" "$apk_sha" 2>/dev/null; then
  fail "malformed evidence SHA-256 must fail"
fi

guard_local_first_cutover 2000001 2000001 || fail "local-first cutover floor must pass"
guard_local_first_cutover 2000001 2000002 || fail "later patches keep the local-first floor"
if guard_local_first_cutover 2000000 2000001 2>/dev/null; then fail "PR A minimum must not permit PR B publish"; fi
if guard_local_first_cutover 1000000 2000001 2>/dev/null; then fail "1.x minimum must reject local-first cutover"; fi

python3 "$ROOT/scripts/android-release/android_contract.py" version 1.0.2 | grep -q '1000002' || fail "version parser"
if python3 "$ROOT/scripts/android-release/android_contract.py" version 1.0.02 >/dev/null 2>&1; then fail "invalid version must fail"; fi
bash "$ROOT/scripts/android-release/test-android-contract.sh"
