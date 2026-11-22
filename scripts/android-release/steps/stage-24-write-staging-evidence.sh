#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (stage step 37: Write immutable staging evidence (production version.json 保持不变)).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
# staging evidence 的唯一用途：让 publish 阶段**不重建 APK**也能证明「它要广播的那个
# APK 就是这里验证过的那个」。production version.json 是强制更新的 commit point，
# 本阶段绝不触碰它 —— 真机 A14 验证失败或未完成时，线上 manifest 必须原样不动。
APK_NAME="$STEP_ARTIFACT_APKNAME"
STAGING_NAME="${APK_NAME%.apk}.staging.json"
EXISTING="$RUNNER_TEMP/delta-existing-staging.json"
STATUS="$STEP_DELTA_EXISTINGEVIDENCE"
case "$STATUS" in
  404) jq --slurpfile delta "$RUNNER_TEMP/delta-metadata.json" '. + $delta[0]' "$RUNNER_TEMP/bundle-evidence.json" > "release-staging/$STAGING_NAME" ;;
  200)
    python3 scripts/android-release/android_contract.py bundle \
      --badging "$RUNNER_TEMP/apk-badging.txt" --apk "android/app/build/outputs/apk/release/app-release.apk" --contract contracts/android-native-bridge.json \
      --pin deploy/agent/source.json --source "$STEP_VERSION_COMMIT" \
      --version "$STEP_VERSION_VERSIONNAME" --evidence "$EXISTING" >/dev/null
    cp "$EXISTING" "release-staging/$STAGING_NAME"
    ;;
  *) echo "::error::Cannot verify existing immutable staging evidence (HTTP $STATUS)" >&2; exit 1 ;;
esac
cat "release-staging/$STAGING_NAME"
echo "stagingName=$STAGING_NAME" >> "$GITHUB_OUTPUT"
