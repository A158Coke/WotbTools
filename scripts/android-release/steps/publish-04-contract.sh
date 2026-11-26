#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (publish step 4: Android contract and committed version gate (current main policy)).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
python3 scripts/android-release/android_contract.py validate \
  --contract contracts/android-native-bridge.json \
  --gradle-properties android/gradle.properties \
  --frontend frontend/src/platform/nativeBridgeContract.js \
  --native-source android/app/src/main/java/com/wotbtools/app/NativeBridge.kt \
  --native-source android/app/src/main/java/com/wotbtools/app/MainActivity.kt \
  --native-source android/app/src/main/java/com/wotbtools/app/ReplayIntentHandler.kt \
  --frontend-source frontend/src/platform/nativeBridgeContract.js \
  --frontend-source frontend/src/platform/androidAuthProvider.ts
