#!/usr/bin/env bash
# Classify immutable evidence before admitting optional work.
# Leave a usable full-only record even if fresh delta preparation times out.
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
elif [ "$STATUS" = 404 ]; then
  BASE_MANIFEST="$RUNNER_TEMP/prod-version.json"
  if [ -s "$BASE_MANIFEST" ] && jq -e --argjson target "$TARGET_CODE" '.latestVersionCode == $target' "$BASE_MANIFEST" >/dev/null; then
    echo "::error::Production already advertises this version but both staging evidence files are missing" >&2
    exit 1
  fi
  python3 scripts/android-release/delta_artifact.py build --target "$TARGET" --target-sha "$TARGET_SHA" \
    --target-code "$TARGET_CODE" --xdelta unused --output-dir release-staging --output "$META"
else
  echo "::error::Cannot check immutable staging evidence (HTTP $STATUS)" >&2
  exit 1
fi
echo "existingEvidence=$STATUS" >> "$GITHUB_OUTPUT"
if [[ $STATUS == 200 ]] && jq -e '.patches | length == 0' "$META" >/dev/null; then exit 0; fi

# The clock starts after checkout (bounded to 5m). Leave 15m for resolution,
# evidence and handoff, plus 2m for runner transitions and cancellation.
now=$(date +%s)
[[ $JOB_START_EPOCH =~ ^[0-9]+$ && $JOB_TIMEOUT_SECONDS =~ ^[0-9]+$ && $now -ge $JOB_START_EPOCH ]]
remaining=$((JOB_START_EPOCH + JOB_TIMEOUT_SECONDS - now - (5 + 15 + 2) * 60))
# Two units for preparation, four per cloud upload, one for each of six TX
# operations and the public readback. All ten step timeouts fit in this sum.
unit=$((remaining / (17 * 60)))
if (( unit < 1 )); then
  if [[ $STATUS == 200 ]]; then
    echo "::error::Insufficient Stage time for the immutable staged patch" >&2
    exit 1
  fi
  echo "::notice::Insufficient Stage time for an optional patch; keeping full-only metadata."
  exit 0
fi
if (( unit > 10 )); then unit=10; fi
{
  echo "tryDelta=true"
  echo "prepareMinutes=$((2 * unit))"
  echo "uploadMinutes=$((4 * unit))"
  echo "replicaMinutes=$unit"
} >> "$GITHUB_OUTPUT"
