#!/usr/bin/env bash
# publish-05 resolved the explicit tag, byte-checked both origins' staging
# evidence, validated the full APK and normalized the existing patch list.
set -Eeuo pipefail
meta="$RUNNER_TEMP/delta-publish.json"
verify_both() {
  local name=$1 size=$2 sha=$3
  for replica in aliyun stable; do
    bash deploy/assets/verify-android-download.sh --replica "$replica" "$name" "$size" "$sha"
  done
}
# Older full-only evidence can omit apkSizeBytes. Its verified APK supplies
# the size; the immutable staged digest still decides which bytes are valid.
size=$(stat -c %s "$RUNNER_TEMP/staged.apk")
verify_both "$STEP_STAGEDREF_APKNAME" "$size" "$STEP_STAGED_APKSHA"
rows=$(jq -r '.patches[] | [(.url | split("/") | last), .size, .sha256] | @tsv' "$meta")
if [[ -n $rows ]]; then
  while IFS=$'\t' read -r name size sha; do
    verify_both "$name" "$size" "$sha"
  done <<< "$rows"
fi
