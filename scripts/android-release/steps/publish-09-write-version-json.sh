#!/usr/bin/env bash
# Extracted from .github/workflows/android-release.yml (publish step 9: Write version.json (commit point, LAST)).
# Behavior is preserved; edit this script, not the workflow YAML.
set -euo pipefail
printf '{\n  "schemaVersion": 1,\n  "latestVersionCode": %s,\n  "latestVersionName": "%s",\n  "minSupportedVersionCode": %s,\n  "nativeBridgeVersion": %s,\n  "sourceSha": "%s",\n  "apkUrl": "https://wotbtools.com/download/android/%s",\n  "sha256": "%s",\n  "publishedAt": "%s",\n  "releaseNotes": ""\n}\n' \
  "$STEP_STAGED_VERSIONCODE" \
  "$STEP_STAGED_VERSIONNAME" \
  "$ANDROID_MIN_SUPPORTED_VERSION_CODE" \
  "$STEP_STAGED_NATIVEBRIDGEVERSION" \
  "$STEP_STAGED_STAGEDSOURCE" \
  "$STEP_STAGEDREF_APKNAME" \
  "$STEP_STAGED_APKSHA" \
  "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "release-staging/version.json"
# 兼容旧 staged evidence：没有 target size 的旧候选不生成新字段。
jq --slurpfile delta "$RUNNER_TEMP/delta-publish.json" \
  'if $delta[0].apkSizeBytes == null then . else . + {apkSizeBytes: $delta[0].apkSizeBytes, patches: $delta[0].patches} end' \
  "release-staging/version.json" > "release-staging/version.json.tmp"
mv "release-staging/version.json.tmp" "release-staging/version.json"
cat "release-staging/version.json"
