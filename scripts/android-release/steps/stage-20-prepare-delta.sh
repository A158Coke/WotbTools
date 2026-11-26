#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 27: Prepare verified direct Android delta).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
TARGET="android/app/build/outputs/apk/release/app-release.apk"
TARGET_CODE="$STEP_VERSION_VERSIONCODE"
TARGET_SHA="$STEP_ARTIFACT_SHA256"
APK_NAME="$STEP_ARTIFACT_APKNAME"
STAGING_NAME="${APK_NAME%.apk}.staging.json"
EXISTING="$RUNNER_TEMP/delta-existing-staging.json"
META="$RUNNER_TEMP/delta-metadata.json"
STATUS="$(bash scripts/android-release/staging-evidence.sh collect "$STAGING_NAME" "$EXISTING")"
if [ "$STATUS" = 200 ]; then
  python3 scripts/android-release/android_contract.py bundle \
    --badging "$RUNNER_TEMP/apk-badging.txt" --apk "$TARGET" --contract contracts/android-native-bridge.json \
    --pin deploy/agent/source.json --source "$STEP_VERSION_COMMIT" \
    --version "$STEP_VERSION_VERSIONNAME" --evidence "$EXISTING" >/dev/null
  python3 scripts/android-release/delta_artifact.py verify --target "$TARGET" --target-sha "$TARGET_SHA" --target-code "$TARGET_CODE" --evidence "$EXISTING" > "$META"
  PATCH_URL="$(jq -r '.patches[0].url // empty' "$META")"
  if [ -n "$PATCH_URL" ]; then
    PATCH_NAME="${PATCH_URL##*/}"
    curl -fsSL --retry 3 --connect-timeout 10 --max-time 300 -o "release-staging/$PATCH_NAME" "$PATCH_URL"
    python3 scripts/android-release/delta_artifact.py verify --target "$TARGET" --target-sha "$TARGET_SHA" --target-code "$TARGET_CODE" --evidence "$EXISTING" --patch-dir release-staging >/dev/null
  fi
elif [ "$STATUS" = 404 ]; then
  BASE_MANIFEST="$RUNNER_TEMP/prod-version.json"
  if [ -s "$BASE_MANIFEST" ] && jq -e --argjson target "$TARGET_CODE" '.latestVersionCode == $target' "$BASE_MANIFEST" >/dev/null; then
    echo "::error::Production already advertises this version but both staging evidence files are missing" >&2
    exit 1
  fi
  BASE_APK="$RUNNER_TEMP/delta-base.apk"
  XDELTA="$RUNNER_TEMP/xdelta3-3.2.2-linux-x86_64/xdelta3"
  built=false
  if [ -s "$BASE_MANIFEST" ] && jq -e --argjson target "$TARGET_CODE" '(.latestVersionCode | type == "number" and . >= 4000000 and . < $target) and (.sha256 | type == "string" and test("^[0-9a-f]{64}$")) and (.apkUrl | type == "string" and test("^https://wotbtools[.]com/download/android/wotbtools-android-v[0-9]+[.][0-9]+[.][0-9]+[.]apk$"))' "$BASE_MANIFEST" >/dev/null; then
    BASE_URL="$(jq -r '.apkUrl' "$BASE_MANIFEST")"
    BASE_SHA="$(jq -r '.sha256' "$BASE_MANIFEST")"
    BASE_CODE="$(jq -r '.latestVersionCode' "$BASE_MANIFEST")"
    TOOL_URL="https://github.com/jmacd/xdelta/releases/download/v3.2.2/xdelta3-3.2.2-linux-x86_64.tar.gz"
    BASE_STAGING="${BASE_URL%.apk}.staging.json"
    if curl -fsSL --retry 2 --connect-timeout 10 --max-time 30 -o "$RUNNER_TEMP/delta-base-staging.json" "$BASE_STAGING" &&
       jq -e --argjson code "$BASE_CODE" --arg sha "$BASE_SHA" '.versionCode == $code and .sha256 == $sha' "$RUNNER_TEMP/delta-base-staging.json" >/dev/null &&
       curl -fsSL --retry 2 --connect-timeout 10 --max-time 300 -o "$BASE_APK" "$BASE_URL" &&
       [ "$(sha256sum "$BASE_APK" | awk '{print $1}')" = "$BASE_SHA" ] &&
       curl -fsSL --retry 2 --connect-timeout 10 --max-time 60 -o "$RUNNER_TEMP/xdelta3.tar.gz" "$TOOL_URL" &&
       echo 'a8ce7d2c943ae2b3d308942643cb36d4805a1f16775abe1be64fee292d7c2506  '"$RUNNER_TEMP/xdelta3.tar.gz" | sha256sum -c - &&
       tar -xzf "$RUNNER_TEMP/xdelta3.tar.gz" -C "$RUNNER_TEMP"; then
      AAPT="$(find "$ANDROID_HOME/build-tools" -name aapt -type f | sort -V | tail -n 1)"
      APKSIGNER="$(find "$ANDROID_HOME/build-tools" -name apksigner -type f | sort -V | tail -n 1)"
      BASE_BADGING="$("$AAPT" dump badging "$BASE_APK")" || BASE_BADGING=""
      TARGET_CERT="$("$APKSIGNER" verify --print-certs "$TARGET" | sed -n 's/^Signer #[0-9]* certificate SHA-256 digest: //p')" || TARGET_CERT=""
      BASE_CERT="$("$APKSIGNER" verify --print-certs "$BASE_APK" | sed -n 's/^Signer #[0-9]* certificate SHA-256 digest: //p')" || BASE_CERT=""
      if [[ "$BASE_BADGING" == "package: name='com.wotbtools.app' versionCode='$BASE_CODE' "* ]] && [ -n "$TARGET_CERT" ] && [ "$BASE_CERT" = "$TARGET_CERT" ] &&
         python3 scripts/android-release/delta_artifact.py build --target "$TARGET" --target-sha "$TARGET_SHA" --target-code "$TARGET_CODE" --xdelta "$XDELTA" --output-dir release-staging --output "$META" --base-manifest "$BASE_MANIFEST" --base-file "$BASE_APK"; then
        built=true
      fi
    fi
  fi
  if [ "$built" = false ]; then
    echo "::notice::Direct delta unavailable; stage the full APK without a patch."
    python3 scripts/android-release/delta_artifact.py build --target "$TARGET" --target-sha "$TARGET_SHA" --target-code "$TARGET_CODE" --xdelta "$XDELTA" --output-dir release-staging --output "$META"
  fi
else
  echo "::error::Cannot check immutable staging evidence (HTTP $STATUS)" >&2
  exit 1
fi
PATCH_NAME="$(jq -r '.patches[0].url // empty | split("/") | last' "$META")"
echo "patchSha=$(jq -r '.patches[0].sha256 // empty' "$META")" >> "$GITHUB_OUTPUT"
echo "patchName=$PATCH_NAME" >> "$GITHUB_OUTPUT"
echo "existingEvidence=$STATUS" >> "$GITHUB_OUTPUT"
cat "$META"
