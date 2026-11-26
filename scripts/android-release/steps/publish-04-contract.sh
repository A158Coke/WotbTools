#!/usr/bin/env bash
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
