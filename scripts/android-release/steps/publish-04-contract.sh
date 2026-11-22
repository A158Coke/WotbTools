#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (publish step 4: Android contract and committed version gate (current main policy)).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
# 当前策略面：当前 main 的 contract + 当前 main 的 committed version 必须自洽
# （stage 同样跑这一段）。候选身份由前面的 staged 步骤单独证明。
python3 scripts/android-release/android_contract.py validate \
  --contract contracts/android-native-bridge.json \
  --gradle-properties android/gradle.properties \
  --frontend frontend/src/platform/nativeBridgeContract.js \
  --native-source android/app/src/main/java/com/wotbtools/app/NativeBridge.kt \
  --native-source android/app/src/main/java/com/wotbtools/app/MainActivity.kt \
  --native-source android/app/src/main/java/com/wotbtools/app/ReplayIntentHandler.kt \
  --frontend-source frontend/src/platform/nativeBridgeContract.js \
  --frontend-source frontend/src/platform/androidAuthProvider.ts
