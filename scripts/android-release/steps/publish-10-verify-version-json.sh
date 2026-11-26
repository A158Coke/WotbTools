#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (publish step 12: Verify production version.json matches the staged artifact).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
URL="https://wotbtools.com/download/android/version.json"
TMP_JSON="$RUNNER_TEMP/prod-version-verify.json"
curl -fsSL -H 'Cache-Control: no-cache' -o "$TMP_JSON" "$URL?cb=$(date +%s%N)"
jq -e --argjson code "$STEP_STAGED_VERSIONCODE" \
      --arg name "$STEP_STAGED_VERSIONNAME" \
      --argjson min "$ANDROID_MIN_SUPPORTED_VERSION_CODE" \
      --arg url "https://wotbtools.com/download/android/$STEP_STAGEDREF_APKNAME" \
      --arg sha "$STEP_STAGED_APKSHA" \
      --argjson bridge "$STEP_STAGED_NATIVEBRIDGEVERSION" \
      --arg source "$STEP_STAGED_STAGEDSOURCE" \
  '.schemaVersion == 1 and .latestVersionCode == $code and .latestVersionName == $name
   and .minSupportedVersionCode == $min and .nativeBridgeVersion == $bridge
   and .sourceSha == $source and .apkUrl == $url and .sha256 == $sha' "$TMP_JSON" \
  || { echo "::error::Production version.json content does not match the staged artifact" >&2; exit 1; }
jq -e --slurpfile delta "$RUNNER_TEMP/delta-publish.json" \
  'if $delta[0].apkSizeBytes == null then ((has("apkSizeBytes") | not) and (has("patches") | not)) else (.apkSizeBytes == $delta[0].apkSizeBytes and .patches == $delta[0].patches) end' "$TMP_JSON" >/dev/null \
  || { echo "::error::Production delta metadata differs from immutable staging evidence" >&2; exit 1; }
echo "Production version.json verified; mandatory update to $STEP_STAGED_VERSIONNAME is live."
