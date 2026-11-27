#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (publish step 6: Preflight publication state and cutover guards (idempotent)).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
. scripts/android-release/check-release-guards.sh
VERSION_CODE="$STEP_STAGED_VERSIONCODE"
VERSION_NAME="$STEP_STAGED_VERSIONNAME"
APK_NAME="$STEP_STAGEDREF_APKNAME"
BRIDGE_VERSION="$STEP_STAGED_NATIVEBRIDGEVERSION"
SOURCE_SHA="$STEP_STAGED_STAGEDSOURCE"
PROD_JSON="$RUNNER_TEMP/prod-version.json"
URL="https://wotbtools.com/download/android/version.json"
CODE="$(curl -s -o "$PROD_JSON" -w '%{http_code}' "$URL")"
PROD_BRIDGE=""
case "$CODE" in
  404)
    echo "No published Android manifest yet."
    PROD_STATE="prod_absent"
    ;;
  200)
    PROD_BRIDGE="$(jq -r '.nativeBridgeVersion // empty' "$PROD_JSON" 2>/dev/null || true)"
    classify_prod "$PROD_JSON" "$VERSION_CODE" "$VERSION_NAME" "$APK_NAME" \
      "$ANDROID_MIN_SUPPORTED_VERSION_CODE" "$BRIDGE_VERSION" "$SOURCE_SHA"
    ;;
  *)
    echo "::error::Unexpected HTTP $CODE fetching production version.json" >&2
    exit 1
    ;;
esac

guard_min_supported "$ANDROID_MIN_SUPPORTED_VERSION_CODE" "$VERSION_CODE"
guard_local_first_cutover "$ANDROID_MIN_SUPPORTED_VERSION_CODE" "$VERSION_CODE"
FE_VERSIONS="$(python3 - <<'PY'
import re
text = open('frontend/src/platform/nativeBridgeContract.js', encoding='utf-8').read()
match = re.search(r'SUPPORTED_NATIVE_BRIDGE_VERSIONS\s*=\s*Object\.freeze\(\[([^\]]*)\]\)', text)
print(','.join(re.findall(r'\b[0-9]+\b', match.group(1))) if match else '')
PY
)"
guard_bridge_covered "$PROD_BRIDGE" "$BRIDGE_VERSION" "$FE_VERSIONS" \
  "$ANDROID_MIN_SUPPORTED_VERSION_CODE" "$VERSION_CODE"
echo "minSupported=$ANDROID_MIN_SUPPORTED_VERSION_CODE prodBridge=${PROD_BRIDGE:-none} frontendBridges=${FE_VERSIONS:-none}"

case "$PROD_STATE" in
  prod_absent|prod_older)
    echo "publishAction=publish" >> "$GITHUB_OUTPUT"
    ;;
  prod_equal_ok)
    PUBLISHED_SHA="$(jq -r '.sha256' "$PROD_JSON")"
    if [ "$PUBLISHED_SHA" != "$STEP_STAGED_APKSHA" ]; then
      echo "::error::Published manifest sha256=$PUBLISHED_SHA does not match the staged APK; refusing." >&2
      exit 1
    fi
    if ! jq -n -e --slurpfile prod "$PROD_JSON" --slurpfile staged "$RUNNER_TEMP/delta-publish.json" '($prod[0].apkSizeBytes // null) == ($staged[0].apkSizeBytes // null) and ($prod[0].patches // []) == ($staged[0].patches // [])' >/dev/null; then
      echo "::error::Published delta metadata differs from immutable staging evidence" >&2; exit 1
    fi
    echo "This version is already published with identical metadata and APK SHA; no-op success."
    echo "publishAction=already-published" >> "$GITHUB_OUTPUT"
    ;;
  prod_equal_conflict)
    echo "::error::Production version.json for the same versionCode does not match release metadata." >&2
    exit 1
    ;;
  prod_newer)
    echo "::error::Android release rollback rejected: production latestVersionCode is newer than this version." >&2
    exit 1
    ;;
  *)
    echo "::error::Unclassified production state: $PROD_STATE" >&2
    exit 1
    ;;
esac
