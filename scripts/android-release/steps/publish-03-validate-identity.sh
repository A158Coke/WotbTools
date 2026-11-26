#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (publish step 3: Validate the staged release source identity (tag target is authoritative)).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
AUTH_PROVIDER="$RUNNER_TEMP/frontend/src/platform/androidAuthProvider.ts"
[ -f "$AUTH_PROVIDER" ] || AUTH_PROVIDER="${AUTH_PROVIDER%.ts}.js"
python3 scripts/android-release/android_contract.py validate \
  --contract "$RUNNER_TEMP/contracts/android-native-bridge.json" \
  --gradle-properties "$RUNNER_TEMP/android/gradle.properties" \
  --frontend "$RUNNER_TEMP/frontend/src/platform/nativeBridgeContract.js" \
  --native-source "$RUNNER_TEMP/android/app/src/main/java/com/wotbtools/app/NativeBridge.kt" \
  --native-source "$RUNNER_TEMP/android/app/src/main/java/com/wotbtools/app/MainActivity.kt" \
  --native-source "$RUNNER_TEMP/android/app/src/main/java/com/wotbtools/app/ReplayIntentHandler.kt" \
  --frontend-source "$RUNNER_TEMP/frontend/src/platform/nativeBridgeContract.js" \
  --frontend-source "$AUTH_PROVIDER"
cmp -s "$RUNNER_TEMP/contracts/android-native-bridge.json" contracts/android-native-bridge.json || {
  echo "::error::Current main's Native Bridge contract differs from the staged release source; publish the staged version with the workflow that staged it." >&2
  exit 1
}
echo "Staged source identity for $REQUESTED_VERSION: tag=$STEP_STAGEDREF_TAGNAME versionCode=$STEP_STAGEDREF_VERSIONCODE bridge=$STEP_STAGEDREF_NATIVEBRIDGEVERSION source=$TAG_TARGET"
